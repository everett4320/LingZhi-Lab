import { describe, expect, it, vi } from 'vitest';
import {
  buildCommandAck,
  resolveClientRequestId,
  sendCommandAck,
} from '../utils/command-ack.js';

describe('command ack utilities', () => {
  it('resolves client request id from top-level payload first', () => {
    const result = resolveClientRequestId({
      clientRequestId: 'req-top',
      options: { clientRequestId: 'req-option' },
    });

    expect(result).toBe('req-top');
  });

  it('falls back to options client request id when top-level id is missing', () => {
    const result = resolveClientRequestId({
      options: { clientRequestId: 'req-option' },
    });

    expect(result).toBe('req-option');
  });

  it('returns null when payload has no valid client request id', () => {
    expect(resolveClientRequestId({})).toBeNull();
    expect(resolveClientRequestId(null)).toBeNull();
    expect(resolveClientRequestId(undefined)).toBeNull();
  });

  it('builds normalized command ack payload', () => {
    expect(buildCommandAck({
      accepted: true,
      provider: 'codex',
      clientRequestId: 'req-1',
      reason: null,
      sessionId: 'session-1',
    })).toEqual({
      type: 'command-ack',
      accepted: true,
      provider: 'codex',
      clientRequestId: 'req-1',
      reason: null,
      sessionId: 'session-1',
    });
  });

  it('sends ack payload through writer', () => {
    const writer = { send: vi.fn() };

    sendCommandAck(writer, {
      accepted: false,
      provider: 'gemini',
      clientRequestId: 'req-2',
      reason: 'session_busy',
      sessionId: 'session-2',
    });

    expect(writer.send).toHaveBeenCalledTimes(1);
    expect(writer.send).toHaveBeenCalledWith({
      type: 'command-ack',
      accepted: false,
      provider: 'gemini',
      clientRequestId: 'req-2',
      reason: 'session_busy',
      sessionId: 'session-2',
    });
  });
});
