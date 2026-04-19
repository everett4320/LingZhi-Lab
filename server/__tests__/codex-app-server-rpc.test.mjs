import { describe, expect, it, vi } from 'vitest';

import {
  createJsonRpcMux,
  METHOD_NOT_FOUND_ERROR_CODE,
  REQUEST_TIMEOUT_ERROR_CODE,
} from '../utils/codexAppServerRpc.js';

function flushMicrotasks() {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, 0);
  });
}

describe('codex app-server rpc mux', () => {
  it('handles standard request/response flow', async () => {
    const outbound = [];
    const mux = createJsonRpcMux({
      sendMessage: (message) => outbound.push(message),
    });

    const promise = mux.request('thread/start', { cwd: '/tmp/project' }, { id: 'req-1' });
    expect(outbound[0]).toEqual({
      jsonrpc: '2.0',
      id: 'req-1',
      method: 'thread/start',
      params: { cwd: '/tmp/project' },
    });

    mux.handleIncoming({
      jsonrpc: '2.0',
      id: 'req-1',
      result: { thread: { id: 'thread-1' } },
    });

    await expect(promise).resolves.toEqual({ thread: { id: 'thread-1' } });
  });

  it('times out pending requests', async () => {
    const mux = createJsonRpcMux({
      sendMessage: () => {},
      defaultTimeoutMs: 5,
    });

    await expect(mux.request('turn/start', { threadId: 'thread-1' }))
      .rejects.toMatchObject({ code: REQUEST_TIMEOUT_ERROR_CODE });
  });

  it('routes notifications to onNotification handler', () => {
    const onNotification = vi.fn();
    const mux = createJsonRpcMux({
      sendMessage: () => {},
      onNotification,
    });

    mux.handleIncoming({
      jsonrpc: '2.0',
      method: 'thread/status/changed',
      params: { threadId: 'thread-1', status: { type: 'active' } },
    });

    expect(onNotification).toHaveBeenCalledWith('thread/status/changed', {
      threadId: 'thread-1',
      status: { type: 'active' },
    });
  });

  it('sends notification without params when omitted', () => {
    const outbound = [];
    const mux = createJsonRpcMux({
      sendMessage: (message) => outbound.push(message),
    });

    mux.notify('initialized');
    expect(outbound[0]).toEqual({
      jsonrpc: '2.0',
      method: 'initialized',
    });
  });

  it('handles server-initiated requests and returns result', async () => {
    const outbound = [];
    const onRequest = vi.fn(async (method, params) => {
      if (method === 'item/tool/requestUserInput') {
        return { answers: {} };
      }
      return { ok: true, params };
    });

    const mux = createJsonRpcMux({
      sendMessage: (message) => outbound.push(message),
      onRequest,
    });

    mux.handleIncoming({
      jsonrpc: '2.0',
      id: 'srv-1',
      method: 'item/tool/requestUserInput',
      params: { threadId: 'thread-1', turnId: 'turn-1' },
    });
    await flushMicrotasks();

    expect(onRequest).toHaveBeenCalledWith(
      'item/tool/requestUserInput',
      { threadId: 'thread-1', turnId: 'turn-1' },
      expect.objectContaining({ id: 'srv-1' }),
    );
    expect(outbound).toContainEqual({
      jsonrpc: '2.0',
      id: 'srv-1',
      result: { answers: {} },
    });
  });

  it('returns method-not-found when server request handler is missing', async () => {
    const outbound = [];
    const mux = createJsonRpcMux({
      sendMessage: (message) => outbound.push(message),
    });

    mux.handleIncoming({
      jsonrpc: '2.0',
      id: 'srv-2',
      method: 'item/tool/call',
      params: { callId: 'call-1' },
    });
    await flushMicrotasks();

    expect(outbound).toContainEqual({
      jsonrpc: '2.0',
      id: 'srv-2',
      error: expect.objectContaining({
        code: METHOD_NOT_FOUND_ERROR_CODE,
      }),
    });
  });

  it('returns normalized error when server request handler throws', async () => {
    const outbound = [];
    const mux = createJsonRpcMux({
      sendMessage: (message) => outbound.push(message),
      onRequest: async () => {
        throw new Error('request failed');
      },
    });

    mux.handleIncoming({
      jsonrpc: '2.0',
      id: 'srv-3',
      method: 'item/fileChange/requestApproval',
      params: {},
    });
    await flushMicrotasks();

    expect(outbound).toContainEqual({
      jsonrpc: '2.0',
      id: 'srv-3',
      error: expect.objectContaining({
        code: -32603,
        message: 'request failed',
      }),
    });
  });
});
