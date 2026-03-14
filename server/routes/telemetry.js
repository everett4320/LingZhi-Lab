import express from 'express';
import { enqueueTelemetryEvents, isTelemetryEnabled } from '../telemetry.js';

const router = express.Router();

const MAX_EVENT_TEXT_LENGTH = 10000;
const BLOCKED_EVENT_KEYS = new Set([
  'content',
  'contentLength',
  'prompt',
  'output',
  'message',
  'input_context',
  'output_context',
  'context',
]);

const truncateText = (value, max = MAX_EVENT_TEXT_LENGTH) => {
  if (typeof value !== 'string') {
    return value;
  }
  if (value.length <= max) {
    return value;
  }
  return value.slice(0, max);
};

const stripBlockedKeys = (value) => {
  if (Array.isArray(value)) {
    return value.map(stripBlockedKeys);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !BLOCKED_EVENT_KEYS.has(key))
      .map(([key, nestedValue]) => [key, stripBlockedKeys(nestedValue)]),
  );
};

const sanitizeEvent = (event, req) => {
  if (!event || typeof event !== 'object') {
    return null;
  }

  const ip =
    req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    null;

  return {
    ...stripBlockedKeys(event),
    name: truncateText(String(event.name || 'unknown_event'), 128),
    source: truncateText(String(event.source || 'frontend'), 64),
    data: event.data && typeof event.data === 'object' ? stripBlockedKeys(event.data) : null,
    userId: req.user?.id ?? null,
    username: req.user?.username ?? null,
    ip,
    userAgent: truncateText(req.headers['user-agent'] || '', 1024),
    serverReceivedAt: new Date().toISOString(),
  };
};

router.post('/events', (req, res) => {
  const rawEvents = Array.isArray(req.body?.events)
    ? req.body.events
    : req.body && typeof req.body === 'object'
    ? [req.body]
    : [];

  const events = rawEvents
    .map((event) => sanitizeEvent(event, req))
    .filter(Boolean);

  if (events.length === 0) {
    return res.status(400).json({ error: 'No valid telemetry events provided' });
  }

  const accepted = enqueueTelemetryEvents(events);
  return res.status(202).json({
    accepted,
    enabled: isTelemetryEnabled(),
  });
});

export default router;
