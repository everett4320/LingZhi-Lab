import { describe, expect, it } from 'vitest';

class ResponseCollector {
  constructor() {
    this.messages = [];
    this.sessionId = null;
  }

  send(data) {
    this.messages.push(data);
    if (typeof data === 'string') {
      try {
        const parsed = JSON.parse(data);
        if (parsed.sessionId) {
          this.sessionId = parsed.sessionId;
        }
      } catch {}
    } else if (data && data.sessionId) {
      this.sessionId = data.sessionId;
    }
  }

  setSessionId(sessionId) {
    this.sessionId = sessionId;
  }

  getSessionId() {
    return this.sessionId;
  }

  getAssistantMessages() {
    const assistantMessages = [];

    for (const msg of this.messages) {
      if (msg && msg.type === 'status') {
        continue;
      }

      let data = msg;
      if (typeof msg === 'string') {
        try {
          data = JSON.parse(msg);
        } catch {
          continue;
        }
      }

      if (!data || typeof data !== 'object') {
        continue;
      }

      if (data.type === 'chat-turn-delta' && typeof data.textDelta === 'string') {
        assistantMessages.push({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: data.textDelta,
          },
        });
      }
    }

    return assistantMessages;
  }

  getTotalTokens() {
    let totalInput = 0;
    let totalOutput = 0;
    let totalCacheRead = 0;
    let totalCacheCreation = 0;

    for (const msg of this.messages) {
      let data = msg;

      if (typeof msg === 'string') {
        try {
          data = JSON.parse(msg);
        } catch {
          continue;
        }
      }
      if (data && data.type === 'chat-turn-complete' && data.usage && typeof data.usage === 'object') {
        const usage = data.usage;
        totalInput += usage.input_tokens || usage.inputTokens || 0;
        totalOutput += usage.output_tokens || usage.outputTokens || 0;
        totalCacheRead += usage.cache_read_input_tokens || usage.cachedInputTokens || 0;
        totalCacheCreation += usage.cache_creation_input_tokens || 0;
      }
    }

    return {
      inputTokens: totalInput,
      outputTokens: totalOutput,
      cacheReadTokens: totalCacheRead,
      cacheCreationTokens: totalCacheCreation,
      totalTokens: totalInput + totalOutput + totalCacheRead + totalCacheCreation,
    };
  }
}

describe('agent ResponseCollector bridge compatibility', () => {
  it('collects assistant deltas from unified chat-turn-delta events', () => {
    const collector = new ResponseCollector();
    collector.send({ type: 'status', message: 'started' });
    collector.send({
      type: 'chat-turn-delta',
      sessionId: 'thread-1',
      textDelta: 'Hello from bridge',
    });

    const messages = collector.getAssistantMessages();
    expect(messages).toEqual([
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: 'Hello from bridge',
        },
      },
    ]);
    expect(collector.getSessionId()).toBe('thread-1');
  });

  it('accumulates usage from unified chat-turn-complete usage payload', () => {
    const collector = new ResponseCollector();
    collector.send({
      type: 'chat-turn-complete',
      usage: {
        inputTokens: 20,
        outputTokens: 5,
        cachedInputTokens: 3,
      },
    });

    expect(collector.getTotalTokens()).toEqual({
      inputTokens: 20,
      outputTokens: 5,
      cacheReadTokens: 3,
      cacheCreationTokens: 0,
      totalTokens: 28,
    });
  });
});
