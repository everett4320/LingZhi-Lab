import { describe, expect, it } from "vitest";

import { isCodexRealtimeMessageSupported } from "../useChatRealtimeHandlers";

describe("isCodexRealtimeMessageSupported", () => {
  it("accepts codex runtime websocket events", () => {
    expect(
      isCodexRealtimeMessageSupported({
        type: "session-status",
        provider: "codex",
      }),
    ).toBe(true);
    expect(
      isCodexRealtimeMessageSupported({
        type: "projects_updated",
      }),
    ).toBe(true);
    expect(
      isCodexRealtimeMessageSupported({
        type: "chat-turn-delta",
        scope: { provider: "codex" },
      }),
    ).toBe(true);
  });

  it("drops non-codex or legacy provider events", () => {
    expect(
      isCodexRealtimeMessageSupported({
        type: "chat-turn-delta",
        provider: "claude",
      }),
    ).toBe(false);
    expect(
      isCodexRealtimeMessageSupported({
        type: "chat-turn-item",
        scope: { provider: "gemini" },
      }),
    ).toBe(false);
    expect(
      isCodexRealtimeMessageSupported({
        type: "session-status",
        scope: { provider: "cursor" },
      }),
    ).toBe(false);
    expect(
      isCodexRealtimeMessageSupported({
        type: "chat-turn-delta",
        scope: { provider: "gemini" },
      }),
    ).toBe(false);
  });

  it("accepts codex chat item and rejects unknown message types", () => {
    expect(
      isCodexRealtimeMessageSupported({
        type: "chat-turn-item",
        scope: { provider: "codex" },
      }),
    ).toBe(true);
    expect(
      isCodexRealtimeMessageSupported({
        type: "some-legacy-event",
        provider: "codex",
      }),
    ).toBe(false);
  });
});
