const MAX_SAMPLES = Number.parseInt(process.env.CODEX_SHADOW_PARITY_MAX_SAMPLES || '', 10) || 200;
const MAX_LATENCY_POINTS = Number.parseInt(process.env.CODEX_SHADOW_PARITY_MAX_LATENCY_POINTS || '', 10) || 2000;
const MAX_BLOCKING_DIFFS = Number.parseInt(process.env.CODEX_SHADOW_MAX_BLOCKING_DIFFS || '', 10) || 0;
const MAX_P95_LATENCY_DELTA_MS = Number.parseInt(process.env.CODEX_SHADOW_MAX_P95_LATENCY_DELTA_MS || '', 10) || 1500;
const MIN_SECONDARY_SUCCESS_RATE = Number.parseFloat(process.env.CODEX_SHADOW_MIN_SECONDARY_SUCCESS_RATE || '');

function nowMs() {
  return Date.now();
}

function normalizeRate(numerator, denominator) {
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  return numerator / denominator;
}

function percentile(values, ratio) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }
  const sorted = [...values]
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (sorted.length === 0) {
    return null;
  }

  const normalizedRatio = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0.95;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(normalizedRatio * sorted.length) - 1),
  );
  return sorted[index];
}

function boundedPush(list, value, maxSize) {
  if (!Array.isArray(list) || !Number.isFinite(value)) {
    return;
  }
  list.push(value);
  if (list.length > maxSize) {
    list.splice(0, list.length - maxSize);
  }
}

function createLaneStats() {
  return {
    count: 0,
    successCount: 0,
    interruptedCount: 0,
    acceptedCount: 0,
    terminalEventCount: 0,
    latencyMs: [],
  };
}

function createInitialState() {
  return {
    startedAt: nowMs(),
    updatedAt: nowMs(),
    comparisons: 0,
    operations: {},
    diffCounts: {
      match: 0,
      warning: 0,
      blocking: 0,
    },
    lanes: {
      primary: createLaneStats(),
      secondary: createLaneStats(),
    },
    sessionRebind: {
      primaryObserved: 0,
      primarySuccess: 0,
      secondaryObserved: 0,
      secondarySuccess: 0,
    },
    interrupt: {
      primaryAttempted: 0,
      primaryConverged: 0,
      secondaryAttempted: 0,
      secondaryConverged: 0,
    },
    recentComparisons: [],
  };
}

const state = createInitialState();

function normalizeLane(label, lane = {}) {
  const status = Number.isFinite(lane.status) ? lane.status : (lane.ok === false ? 500 : 200);
  const ok = lane.ok !== false;
  const interrupted = lane.interrupted === true || lane.terminalState === 'interrupted';
  const accepted = lane.accepted === true;
  const hasTerminalEvent = lane.hasTerminalEvent === true;

  const sessionId = typeof lane.sessionId === 'string' && lane.sessionId.trim()
    ? lane.sessionId.trim()
    : null;
  const provisionalSessionId = typeof lane.provisionalSessionId === 'string' && lane.provisionalSessionId.trim()
    ? lane.provisionalSessionId.trim()
    : null;
  const latencyMs = Number.isFinite(lane.latencyMs) ? Math.max(0, lane.latencyMs) : null;

  let terminalState = lane.terminalState;
  if (!terminalState || typeof terminalState !== 'string') {
    if (interrupted) {
      terminalState = 'interrupted';
    } else if (ok) {
      terminalState = 'completed';
    } else {
      terminalState = 'failed';
    }
  }

  return {
    label,
    ok,
    status,
    terminalState,
    interrupted,
    accepted,
    hasTerminalEvent,
    sessionId,
    provisionalSessionId,
    latencyMs,
    errorType: typeof lane.errorType === 'string' && lane.errorType.trim()
      ? lane.errorType.trim()
      : null,
    details: lane.details && typeof lane.details === 'object' ? lane.details : null,
  };
}

function classifyComparison(primary, secondary) {
  const blockingReasons = [];
  const warningReasons = [];

  if (primary.ok !== secondary.ok) {
    blockingReasons.push('ok_mismatch');
  }
  if (primary.terminalState !== secondary.terminalState) {
    blockingReasons.push('terminal_state_mismatch');
  }
  if (primary.interrupted !== secondary.interrupted) {
    blockingReasons.push('interrupt_mismatch');
  }

  if (primary.accepted !== secondary.accepted) {
    warningReasons.push('accepted_event_mismatch');
  }
  if (primary.hasTerminalEvent !== secondary.hasTerminalEvent) {
    warningReasons.push('terminal_event_mismatch');
  }

  if (primary.sessionId && secondary.sessionId && primary.sessionId !== secondary.sessionId) {
    warningReasons.push('session_id_mismatch');
  }
  if (
    primary.provisionalSessionId &&
    secondary.provisionalSessionId &&
    primary.provisionalSessionId !== secondary.provisionalSessionId
  ) {
    warningReasons.push('provisional_session_id_mismatch');
  }

  if (
    primary.errorType &&
    secondary.errorType &&
    primary.errorType !== secondary.errorType &&
    !primary.ok &&
    !secondary.ok
  ) {
    warningReasons.push('error_type_mismatch');
  }

  if (blockingReasons.length > 0) {
    return {
      classification: 'blocking',
      reasons: [...blockingReasons, ...warningReasons],
    };
  }
  if (warningReasons.length > 0) {
    return {
      classification: 'warning',
      reasons: warningReasons,
    };
  }
  return {
    classification: 'match',
    reasons: [],
  };
}

function updateLaneStats(laneStats, lane) {
  laneStats.count += 1;
  if (lane.ok) {
    laneStats.successCount += 1;
  }
  if (lane.interrupted) {
    laneStats.interruptedCount += 1;
  }
  if (lane.accepted) {
    laneStats.acceptedCount += 1;
  }
  if (lane.hasTerminalEvent) {
    laneStats.terminalEventCount += 1;
  }
  if (lane.latencyMs != null) {
    boundedPush(laneStats.latencyMs, lane.latencyMs, MAX_LATENCY_POINTS);
  }
}

function updateOperationStats(operation, classification) {
  const key = String(operation || 'query');
  if (!state.operations[key]) {
    state.operations[key] = {
      count: 0,
      blocking: 0,
      warning: 0,
      match: 0,
    };
  }

  const stats = state.operations[key];
  stats.count += 1;
  if (classification === 'blocking') {
    stats.blocking += 1;
  } else if (classification === 'warning') {
    stats.warning += 1;
  } else {
    stats.match += 1;
  }
}

function updateRebindStats(prefix, lane) {
  if (!lane.provisionalSessionId) {
    return;
  }

  const observedKey = `${prefix}Observed`;
  const successKey = `${prefix}Success`;
  state.sessionRebind[observedKey] += 1;
  if (lane.sessionId && lane.sessionId !== lane.provisionalSessionId) {
    state.sessionRebind[successKey] += 1;
  }
}

function updateInterruptStats(prefix, lane) {
  if (!lane.interrupted && lane.terminalState !== 'interrupted') {
    return;
  }
  const attemptedKey = `${prefix}Attempted`;
  const convergedKey = `${prefix}Converged`;
  state.interrupt[attemptedKey] += 1;
  if (lane.terminalState === 'interrupted') {
    state.interrupt[convergedKey] += 1;
  }
}

export function recordCodexShadowParityComparison({
  operation = 'query',
  primaryMode = 'legacy',
  secondaryMode = 'bridge',
  primary = {},
  secondary = {},
  context = null,
} = {}) {
  const normalizedPrimary = normalizeLane('primary', primary);
  const normalizedSecondary = normalizeLane('secondary', secondary);
  const { classification, reasons } = classifyComparison(normalizedPrimary, normalizedSecondary);

  state.comparisons += 1;
  state.updatedAt = nowMs();
  state.diffCounts[classification] += 1;
  updateOperationStats(operation, classification);

  updateLaneStats(state.lanes.primary, normalizedPrimary);
  updateLaneStats(state.lanes.secondary, normalizedSecondary);

  updateRebindStats('primary', normalizedPrimary);
  updateRebindStats('secondary', normalizedSecondary);

  updateInterruptStats('primary', normalizedPrimary);
  updateInterruptStats('secondary', normalizedSecondary);

  const sample = {
    comparedAt: state.updatedAt,
    operation: String(operation || 'query'),
    primaryMode: String(primaryMode || 'legacy'),
    secondaryMode: String(secondaryMode || 'bridge'),
    classification,
    reasons,
    primary: normalizedPrimary,
    secondary: normalizedSecondary,
    context: context && typeof context === 'object' ? context : null,
  };

  state.recentComparisons.push(sample);
  if (state.recentComparisons.length > MAX_SAMPLES) {
    state.recentComparisons.splice(0, state.recentComparisons.length - MAX_SAMPLES);
  }

  return sample;
}

function buildLaneSnapshot(laneStats) {
  const successRate = normalizeRate(laneStats.successCount, laneStats.count);
  const interruptRate = normalizeRate(laneStats.interruptedCount, laneStats.count);
  const acceptedRate = normalizeRate(laneStats.acceptedCount, laneStats.count);
  const terminalEventRate = normalizeRate(laneStats.terminalEventCount, laneStats.count);

  return {
    count: laneStats.count,
    successRate,
    interruptedRate: interruptRate,
    acceptedRate,
    terminalEventRate,
    p95LatencyMs: percentile(laneStats.latencyMs, 0.95),
  };
}

export function getCodexShadowParitySnapshot() {
  const primarySnapshot = buildLaneSnapshot(state.lanes.primary);
  const secondarySnapshot = buildLaneSnapshot(state.lanes.secondary);
  const p95LatencyDeltaMs =
    Number.isFinite(primarySnapshot.p95LatencyMs) && Number.isFinite(secondarySnapshot.p95LatencyMs)
      ? secondarySnapshot.p95LatencyMs - primarySnapshot.p95LatencyMs
      : null;

  const effectiveMinSecondarySuccessRate = Number.isFinite(MIN_SECONDARY_SUCCESS_RATE)
    ? MIN_SECONDARY_SUCCESS_RATE
    : (primarySnapshot.successRate ?? 0);

  const goNoGo = {
    maxBlockingDiffs: MAX_BLOCKING_DIFFS,
    maxP95LatencyDeltaMs: MAX_P95_LATENCY_DELTA_MS,
    minSecondarySuccessRate: effectiveMinSecondarySuccessRate,
    blockingDiffGatePassed: state.diffCounts.blocking <= MAX_BLOCKING_DIFFS,
    latencyGatePassed: p95LatencyDeltaMs == null || p95LatencyDeltaMs <= MAX_P95_LATENCY_DELTA_MS,
    successGatePassed:
      secondarySnapshot.successRate == null
      || secondarySnapshot.successRate >= effectiveMinSecondarySuccessRate,
  };
  goNoGo.passed = goNoGo.blockingDiffGatePassed && goNoGo.latencyGatePassed && goNoGo.successGatePassed;

  return {
    startedAt: state.startedAt,
    updatedAt: state.updatedAt,
    comparisons: state.comparisons,
    diffCounts: { ...state.diffCounts },
    operations: { ...state.operations },
    lanes: {
      primary: primarySnapshot,
      secondary: secondarySnapshot,
      p95LatencyDeltaMs,
    },
    sessionRebind: {
      ...state.sessionRebind,
      primarySuccessRate: normalizeRate(state.sessionRebind.primarySuccess, state.sessionRebind.primaryObserved),
      secondarySuccessRate: normalizeRate(state.sessionRebind.secondarySuccess, state.sessionRebind.secondaryObserved),
    },
    interrupt: {
      ...state.interrupt,
      primaryConvergenceRate: normalizeRate(state.interrupt.primaryConverged, state.interrupt.primaryAttempted),
      secondaryConvergenceRate: normalizeRate(state.interrupt.secondaryConverged, state.interrupt.secondaryAttempted),
    },
    goNoGo,
    recentComparisons: state.recentComparisons.slice(-Math.min(30, state.recentComparisons.length)),
  };
}

export function resetCodexShadowParityMetrics() {
  const freshState = createInitialState();
  state.startedAt = freshState.startedAt;
  state.updatedAt = freshState.updatedAt;
  state.comparisons = freshState.comparisons;
  state.operations = freshState.operations;
  state.diffCounts = freshState.diffCounts;
  state.lanes = freshState.lanes;
  state.sessionRebind = freshState.sessionRebind;
  state.interrupt = freshState.interrupt;
  state.recentComparisons = freshState.recentComparisons;
}

