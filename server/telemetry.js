import fetch from 'node-fetch';

const DEFAULT_TELEMETRY_ENDPOINT =
  'https://vibe-telemetry-collector-1002374823539.us-central1.run.app/events';
const DEFAULT_TELEMETRY_AUTH_TOKEN =
  'a02ba6627d6515a1b59521772f074c6bd9bfc2734c333760bd0b83acf28e1f71';

const TELEMETRY_ENDPOINT = (process.env.TELEMETRY_ENDPOINT ?? DEFAULT_TELEMETRY_ENDPOINT).trim();
const TELEMETRY_AUTH_TOKEN = (process.env.TELEMETRY_AUTH_TOKEN ?? DEFAULT_TELEMETRY_AUTH_TOKEN).trim();
const TELEMETRY_FORCE_DISABLE = process.env.TELEMETRY_FORCE_DISABLE === 'true';
const TELEMETRY_BATCH_SIZE = Math.max(1, Number.parseInt(process.env.TELEMETRY_BATCH_SIZE || '20', 10));
const TELEMETRY_FLUSH_INTERVAL_MS = Math.max(
  200,
  Number.parseInt(process.env.TELEMETRY_FLUSH_INTERVAL_MS || '1500', 10),
);
const TELEMETRY_MAX_QUEUE = Math.max(100, Number.parseInt(process.env.TELEMETRY_MAX_QUEUE || '2000', 10));

let queue = [];
let flushTimer = null;
let isFlushing = false;

export function isTelemetryEnabled() {
  return !TELEMETRY_FORCE_DISABLE && Boolean(TELEMETRY_ENDPOINT);
}

function scheduleFlush() {
  if (flushTimer) {
    return;
  }
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushTelemetryQueue().catch((error) => {
      console.error('[telemetry] flush timer failed:', error);
    });
  }, TELEMETRY_FLUSH_INTERVAL_MS);
}

async function postEvents(events) {
  const headers = {
    'Content-Type': 'application/json',
  };
  if (TELEMETRY_AUTH_TOKEN) {
    headers.Authorization = `Bearer ${TELEMETRY_AUTH_TOKEN}`;
  }

  const response = await fetch(TELEMETRY_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      source: 'lingzhi-lab',
      sentAt: new Date().toISOString(),
      events,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status}${body ? `: ${body.slice(0, 300)}` : ''}`);
  }
}

export async function flushTelemetryQueue() {
  if (!isTelemetryEnabled() || isFlushing || queue.length === 0) {
    return;
  }

  isFlushing = true;
  const batch = queue.splice(0, TELEMETRY_BATCH_SIZE);

  try {
    await postEvents(batch);
  } catch (error) {
    // Requeue at front on transient failures, bounded to max queue size.
    queue = [...batch, ...queue].slice(0, TELEMETRY_MAX_QUEUE);
    console.error('[telemetry] failed to send events:', error.message || error);
  } finally {
    isFlushing = false;
    if (queue.length > 0) {
      scheduleFlush();
    }
  }
}

export function enqueueTelemetryEvent(event) {
  if (!isTelemetryEnabled() || !event || typeof event !== 'object') {
    return false;
  }

  queue.push({
    ...event,
    receivedAt: event.receivedAt || new Date().toISOString(),
  });

  if (queue.length > TELEMETRY_MAX_QUEUE) {
    queue = queue.slice(queue.length - TELEMETRY_MAX_QUEUE);
  }

  if (queue.length >= TELEMETRY_BATCH_SIZE) {
    flushTelemetryQueue().catch((error) => {
      console.error('[telemetry] immediate flush failed:', error);
    });
  } else {
    scheduleFlush();
  }

  return true;
}

export function enqueueTelemetryEvents(events) {
  if (!Array.isArray(events) || events.length === 0) {
    return 0;
  }

  let accepted = 0;
  for (const event of events) {
    if (enqueueTelemetryEvent(event)) {
      accepted += 1;
    }
  }
  return accepted;
}
