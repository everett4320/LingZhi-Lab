import type {
  CodexInputMessage,
  CodexInputState,
  CodexInputSteerRejection,
} from '../types/types';

export type SessionInputStateMap = Record<string, CodexInputState>;

export type CodexInputSubmitMode = 'start' | 'steer' | 'queue';

export type CodexInputSubmitResolution =
  | { action: 'start'; message: CodexInputMessage }
  | { action: 'steer'; message: CodexInputMessage }
  | { action: 'queued'; message: CodexInputMessage };

export type CodexInputDispatchResolution =
  | { action: 'dispatch-none' }
  | { action: 'dispatch-start'; message: CodexInputMessage }
  | { action: 'dispatch-merge-start'; messages: CodexInputMessage[]; merged: CodexInputMessage };

type CodexInputCompareKey = {
  text?: string;
  localImagesCount?: number;
  remoteImageUrlsCount?: number;
  mentionBindingsCount?: number;
  documentCount?: number;
};

const EMPTY_ARRAY: never[] = [];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeSessionMode(value: unknown): 'research' | 'workspace_qa' {
  return value === 'workspace_qa' ? 'workspace_qa' : 'research';
}

function normalizeMessageCandidate(candidate: Partial<CodexInputMessage> & { text?: unknown }): CodexInputMessage {
  const id =
    isNonEmptyString(candidate.id)
      ? candidate.id.trim()
      : `input-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const text = typeof candidate.text === 'string' ? candidate.text : '';

  const textElements = Array.isArray(candidate.textElements)
    ? [...candidate.textElements]
    : [];

  const localImages = Array.isArray(candidate.localImages)
    ? candidate.localImages
        .filter((entry): entry is string => isNonEmptyString(entry))
        .map((entry) => entry.trim())
    : [];

  const remoteImageUrls = Array.isArray(candidate.remoteImageUrls)
    ? candidate.remoteImageUrls
        .filter((entry): entry is string => isNonEmptyString(entry))
        .map((entry) => entry.trim())
    : [];

  const mentionBindings = Array.isArray(candidate.mentionBindings)
    ? [...candidate.mentionBindings]
    : [];

  return {
    id,
    text,
    textElements,
    localImages,
    remoteImageUrls,
    mentionBindings,
    createdAt: Number.isFinite(candidate.createdAt) ? Number(candidate.createdAt) : Date.now(),
    projectName: isNonEmptyString(candidate.projectName) ? candidate.projectName.trim() : undefined,
    projectPath: isNonEmptyString(candidate.projectPath) ? candidate.projectPath.trim() : undefined,
    sessionMode: normalizeSessionMode(candidate.sessionMode),
    expectedTurnId: isNonEmptyString(candidate.expectedTurnId) ? candidate.expectedTurnId.trim() : undefined,
    clientTurnId: isNonEmptyString(candidate.clientTurnId) ? candidate.clientTurnId.trim() : undefined,
  };
}

export function createCodexInputMessage(candidate: Partial<CodexInputMessage> & { text?: unknown } = {}): CodexInputMessage {
  return normalizeMessageCandidate(candidate);
}

export function createEmptyCodexInputState(): CodexInputState {
  return {
    composerDraft: null,
    queuedUserMessages: [],
    pendingSteers: [],
    rejectedSteersQueue: [],
    recentSteerRejections: [],
    activeTurnId: null,
    taskRunning: false,
    sessionBinding: {
      provisionalSessionId: null,
      sessionId: null,
    },
    interruptRequestedForPendingSteers: false,
  };
}

export function getSessionInputState(
  stateBySession: SessionInputStateMap = {},
  sessionId: string | null | undefined = null,
): CodexInputState {
  if (!isNonEmptyString(sessionId)) {
    return createEmptyCodexInputState();
  }
  return stateBySession[sessionId] || createEmptyCodexInputState();
}

export function upsertSessionInputState(
  stateBySession: SessionInputStateMap = {},
  sessionId: string | null | undefined = null,
  updater: CodexInputState | ((state: CodexInputState) => CodexInputState),
): SessionInputStateMap {
  if (!isNonEmptyString(sessionId)) {
    return stateBySession;
  }

  const key = sessionId.trim();
  const current = getSessionInputState(stateBySession, key);
  const next = typeof updater === 'function' ? updater(current) : updater;
  if (!next || typeof next !== 'object') {
    return stateBySession;
  }

  return {
    ...stateBySession,
    [key]: next,
  };
}

export function compareSteerMessage(
  candidate: CodexInputMessage | null | undefined,
  compareKey: CodexInputCompareKey | null | undefined,
): boolean {
  if (!candidate || !compareKey) {
    return false;
  }

  const candidateText = typeof candidate.text === 'string' ? candidate.text.trim() : '';
  const compareText = typeof compareKey.text === 'string' ? compareKey.text.trim() : '';
  const candidateLocalImagesCount = Array.isArray(candidate.localImages) ? candidate.localImages.length : 0;
  const candidateRemoteImagesCount = Array.isArray(candidate.remoteImageUrls) ? candidate.remoteImageUrls.length : 0;
  const candidateMentionCount = Array.isArray(candidate.mentionBindings) ? candidate.mentionBindings.length : 0;

  const compareLocalImagesCount = Number.isFinite(compareKey.localImagesCount) ? Number(compareKey.localImagesCount) : 0;
  const compareRemoteImagesCount = Number.isFinite(compareKey.remoteImageUrlsCount) ? Number(compareKey.remoteImageUrlsCount) : 0;
  const compareMentionCount = Number.isFinite(compareKey.mentionBindingsCount) ? Number(compareKey.mentionBindingsCount) : 0;
  const compareDocumentCount = Number.isFinite(compareKey.documentCount) ? Number(compareKey.documentCount) : 0;

  return (
    candidateText === compareText
    && candidateLocalImagesCount === compareLocalImagesCount
    && candidateRemoteImagesCount === compareRemoteImagesCount
    && candidateMentionCount === compareMentionCount
    && compareDocumentCount === 0
  );
}

export function buildMessageCompareKey(message: CodexInputMessage | null | undefined): CodexInputCompareKey | null {
  if (!message) {
    return null;
  }

  return {
    text: typeof message.text === 'string' ? message.text.trim() : '',
    localImagesCount: Array.isArray(message.localImages) ? message.localImages.length : 0,
    remoteImageUrlsCount: Array.isArray(message.remoteImageUrls) ? message.remoteImageUrls.length : 0,
    mentionBindingsCount: Array.isArray(message.mentionBindings) ? message.mentionBindings.length : 0,
    documentCount: 0,
  };
}

export function reduceCodexInputSubmit(
  state: CodexInputState,
  message: Partial<CodexInputMessage> & { text?: unknown },
  mode: CodexInputSubmitMode,
): { state: CodexInputState; resolution: CodexInputSubmitResolution } {
  const normalizedMessage = createCodexInputMessage(message);

  if (mode === 'queue') {
    return {
      state: {
        ...state,
        queuedUserMessages: [...state.queuedUserMessages, normalizedMessage],
      },
      resolution: {
        action: 'queued',
        message: normalizedMessage,
      },
    };
  }

  if (mode === 'steer') {
    return {
      state: {
        ...state,
        pendingSteers: [...state.pendingSteers, normalizedMessage],
      },
      resolution: {
        action: 'steer',
        message: normalizedMessage,
      },
    };
  }

  return {
    state: {
      ...state,
      taskRunning: true,
    },
    resolution: {
      action: 'start',
      message: normalizedMessage,
    },
  };
}

export function reduceCodexSteerCommitted(
  state: CodexInputState,
  compareKey: CodexInputCompareKey | null | undefined,
): CodexInputState {
  if (!Array.isArray(state.pendingSteers) || state.pendingSteers.length === 0) {
    return state;
  }

  const pendingSteers = [...state.pendingSteers];
  let removeIndex = -1;

  if (compareKey && typeof compareKey === 'object') {
    removeIndex = pendingSteers.findIndex((entry) => compareSteerMessage(entry, compareKey));
  }
  if (removeIndex < 0) {
    removeIndex = 0;
  }

  pendingSteers.splice(removeIndex, 1);
  return {
    ...state,
    pendingSteers,
  };
}

export function reduceCodexSteerRejected(
  state: CodexInputState,
  rejection: Partial<CodexInputSteerRejection>,
  fallbackPendingSteer: Partial<CodexInputMessage> | null = null,
): CodexInputState {
  const normalizedRejection: CodexInputSteerRejection = {
    clientTurnId: isNonEmptyString(rejection?.clientTurnId) ? rejection.clientTurnId.trim() : null,
    turnKind: isNonEmptyString(rejection?.turnKind) ? rejection.turnKind.trim() : null,
    rejectedAt: Number.isFinite(rejection?.rejectedAt) ? Number(rejection.rejectedAt) : Date.now(),
  };

  let pendingSteers = [...state.pendingSteers];
  let rejectedMessage: CodexInputMessage | null = null;

  if (normalizedRejection.clientTurnId) {
    const idx = pendingSteers.findIndex((entry) => (entry.clientTurnId || entry.id) === normalizedRejection.clientTurnId);
    if (idx >= 0) {
      rejectedMessage = pendingSteers[idx];
      pendingSteers.splice(idx, 1);
    }
  }

  if (!rejectedMessage && pendingSteers.length > 0) {
    rejectedMessage = pendingSteers[0];
    pendingSteers = pendingSteers.slice(1);
  }

  if (!rejectedMessage && fallbackPendingSteer) {
    rejectedMessage = createCodexInputMessage(fallbackPendingSteer);
  }

  const rejectedSteersQueue = rejectedMessage
    ? [...state.rejectedSteersQueue, rejectedMessage]
    : [...state.rejectedSteersQueue];

  return {
    ...state,
    pendingSteers,
    rejectedSteersQueue,
    recentSteerRejections: [...state.recentSteerRejections, normalizedRejection].slice(-20),
  };
}

export function reduceCodexTurnStarted(
  state: CodexInputState,
  turnId: string | null | undefined = null,
): CodexInputState {
  return {
    ...state,
    taskRunning: true,
    activeTurnId: isNonEmptyString(turnId) ? turnId.trim() : state.activeTurnId,
  };
}

function mergeMessagesToSingle(messages: Array<Partial<CodexInputMessage> | null | undefined>): CodexInputMessage | null {
  const normalizedMessages = messages
    .filter((entry): entry is Partial<CodexInputMessage> => Boolean(entry && typeof entry === 'object'))
    .map((entry) => createCodexInputMessage(entry));

  if (normalizedMessages.length === 0) {
    return null;
  }

  if (normalizedMessages.length === 1) {
    return normalizedMessages[0];
  }

  const mergedText = normalizedMessages
    .map((entry) => String(entry.text || '').trim())
    .filter(Boolean)
    .join('\n\n');

  const mergedTextElements = normalizedMessages.flatMap((entry) => entry.textElements || EMPTY_ARRAY);
  const mergedLocalImages = normalizedMessages.flatMap((entry) => entry.localImages || EMPTY_ARRAY);
  const mergedRemoteImageUrls = normalizedMessages.flatMap((entry) => entry.remoteImageUrls || EMPTY_ARRAY);
  const mergedMentionBindings = normalizedMessages.flatMap((entry) => entry.mentionBindings || EMPTY_ARRAY);
  const first = normalizedMessages[0];

  return createCodexInputMessage({
    id: `merged-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    text: mergedText,
    textElements: mergedTextElements,
    localImages: mergedLocalImages,
    remoteImageUrls: mergedRemoteImageUrls,
    mentionBindings: mergedMentionBindings,
    createdAt: first.createdAt,
    projectName: first.projectName,
    projectPath: first.projectPath,
    sessionMode: first.sessionMode,
    expectedTurnId: first.expectedTurnId,
    clientTurnId: first.clientTurnId,
  });
}

export function reduceCodexTurnCompleted(
  state: CodexInputState,
): { state: CodexInputState; resolution: CodexInputDispatchResolution } {
  const rejectedQueue = Array.isArray(state.rejectedSteersQueue) ? [...state.rejectedSteersQueue] : [];
  const queued = Array.isArray(state.queuedUserMessages) ? [...state.queuedUserMessages] : [];

  if (rejectedQueue.length > 0) {
    const merged = mergeMessagesToSingle(rejectedQueue);
    return {
      state: {
        ...state,
        taskRunning: false,
        activeTurnId: null,
        rejectedSteersQueue: [],
        pendingSteers: [],
      },
      resolution: merged
        ? { action: 'dispatch-merge-start', messages: rejectedQueue, merged }
        : { action: 'dispatch-none' },
    };
  }

  if (queued.length > 0) {
    const [nextMessage, ...remaining] = queued;
    return {
      state: {
        ...state,
        taskRunning: false,
        activeTurnId: null,
        queuedUserMessages: remaining,
      },
      resolution: { action: 'dispatch-start', message: nextMessage },
    };
  }

  return {
    state: {
      ...state,
      taskRunning: false,
      activeTurnId: null,
    },
    resolution: { action: 'dispatch-none' },
  };
}

export function reduceCodexTurnAborted(
  state: CodexInputState,
  options: { interruptForPendingSteers?: boolean } = {},
): { state: CodexInputState; resolution: CodexInputDispatchResolution } {
  const pendingSteers = Array.isArray(state.pendingSteers) ? [...state.pendingSteers] : [];
  const rejectedSteersQueue = Array.isArray(state.rejectedSteersQueue) ? [...state.rejectedSteersQueue] : [];
  const queuedUserMessages = Array.isArray(state.queuedUserMessages) ? [...state.queuedUserMessages] : [];
  const composerDraft = state.composerDraft ? createCodexInputMessage(state.composerDraft) : null;

  if (options.interruptForPendingSteers === true && pendingSteers.length > 0) {
    const merged = mergeMessagesToSingle(pendingSteers);
    return {
      state: {
        ...state,
        pendingSteers: [],
        rejectedSteersQueue: [],
        queuedUserMessages,
        composerDraft: null,
        taskRunning: false,
        activeTurnId: null,
        interruptRequestedForPendingSteers: false,
      },
      resolution: merged
        ? { action: 'dispatch-merge-start', messages: pendingSteers, merged }
        : { action: 'dispatch-none' },
    };
  }

  const recovered = [
    ...rejectedSteersQueue,
    ...pendingSteers,
    ...queuedUserMessages,
    ...(composerDraft ? [composerDraft] : []),
  ];
  const mergedDraft = mergeMessagesToSingle(recovered);

  return {
    state: {
      ...state,
      pendingSteers: [],
      rejectedSteersQueue: [],
      queuedUserMessages: [],
      composerDraft: mergedDraft,
      taskRunning: false,
      activeTurnId: null,
      interruptRequestedForPendingSteers: false,
    },
    resolution: { action: 'dispatch-none' },
  };
}

export function reconcileSessionInputStateId(
  stateBySession: SessionInputStateMap = {},
  fromSessionId: string | null | undefined = null,
  toSessionId: string | null | undefined = null,
): SessionInputStateMap {
  if (!isNonEmptyString(fromSessionId) || !isNonEmptyString(toSessionId)) {
    return stateBySession;
  }

  const fromKey = fromSessionId.trim();
  const toKey = toSessionId.trim();

  if (fromKey === toKey || !stateBySession[fromKey]) {
    return stateBySession;
  }

  const sourceState = stateBySession[fromKey];
  const targetState = stateBySession[toKey] || createEmptyCodexInputState();

  const mergedState: CodexInputState = {
    ...targetState,
    composerDraft: targetState.composerDraft || sourceState.composerDraft,
    queuedUserMessages: [...targetState.queuedUserMessages, ...sourceState.queuedUserMessages],
    pendingSteers: [...targetState.pendingSteers, ...sourceState.pendingSteers],
    rejectedSteersQueue: [...targetState.rejectedSteersQueue, ...sourceState.rejectedSteersQueue],
    recentSteerRejections: [...targetState.recentSteerRejections, ...sourceState.recentSteerRejections].slice(-20),
    activeTurnId: targetState.activeTurnId || sourceState.activeTurnId,
    taskRunning: targetState.taskRunning || sourceState.taskRunning,
    sessionBinding: {
      provisionalSessionId:
        sourceState.sessionBinding?.provisionalSessionId
        || targetState.sessionBinding?.provisionalSessionId
        || null,
      sessionId: toKey,
    },
    interruptRequestedForPendingSteers:
      targetState.interruptRequestedForPendingSteers
      || sourceState.interruptRequestedForPendingSteers,
  };

  const { [fromKey]: _removed, ...rest } = stateBySession;
  return {
    ...rest,
    [toKey]: mergedState,
  };
}

export function updateSessionBinding(
  state: CodexInputState,
  binding: { provisionalSessionId?: string | null; sessionId?: string | null } = {},
): CodexInputState {
  return {
    ...state,
    sessionBinding: {
      provisionalSessionId: isNonEmptyString(binding.provisionalSessionId)
        ? binding.provisionalSessionId.trim()
        : state.sessionBinding?.provisionalSessionId || null,
      sessionId: isNonEmptyString(binding.sessionId)
        ? binding.sessionId.trim()
        : state.sessionBinding?.sessionId || null,
    },
  };
}

export function setComposerDraft(
  state: CodexInputState,
  message: Partial<CodexInputMessage> | null = null,
): CodexInputState {
  return {
    ...state,
    composerDraft: message ? createCodexInputMessage(message) : null,
  };
}

export function popLastQueuedMessage(
  state: CodexInputState,
): { state: CodexInputState; popped: CodexInputMessage | null } {
  if (!Array.isArray(state.queuedUserMessages) || state.queuedUserMessages.length === 0) {
    return {
      state,
      popped: null,
    };
  }

  const queue = [...state.queuedUserMessages];
  const popped = queue.pop() || null;
  return {
    state: {
      ...state,
      queuedUserMessages: queue,
      composerDraft: popped || state.composerDraft,
    },
    popped,
  };
}

export function deriveSteerCompareSignature(compareKey: CodexInputCompareKey | null = null): string | null {
  if (!compareKey) {
    return null;
  }
  return [
    typeof compareKey.text === 'string' ? compareKey.text.trim() : '',
    Number.isFinite(compareKey.localImagesCount) ? Number(compareKey.localImagesCount) : 0,
    Number.isFinite(compareKey.remoteImageUrlsCount) ? Number(compareKey.remoteImageUrlsCount) : 0,
    Number.isFinite(compareKey.mentionBindingsCount) ? Number(compareKey.mentionBindingsCount) : 0,
    Number.isFinite(compareKey.documentCount) ? Number(compareKey.documentCount) : 0,
  ].join('::');
}

export function deriveMessageSignature(message: CodexInputMessage | null = null): string | null {
  if (!message) {
    return null;
  }
  return [
    typeof message.text === 'string' ? message.text.trim() : '',
    Array.isArray(message.localImages) ? message.localImages.length : 0,
    Array.isArray(message.remoteImageUrls) ? message.remoteImageUrls.length : 0,
    Array.isArray(message.mentionBindings) ? message.mentionBindings.length : 0,
    (message.localImages || []).join('|'),
    (message.remoteImageUrls || []).join('|'),
  ].join('::');
}
