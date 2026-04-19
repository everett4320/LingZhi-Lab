import { describe, expect, it } from "vitest";

import {
  applyQueuedTurnTerminalOutcome,
  deriveQueueDispatchState,
  resolvePreferredCodexSessionId,
} from "../useChatComposerState";
import {
  buildQueuedTurn,
  type SessionQueueMap,
} from "../../utils/codexQueue";

describe("useChatComposerState queue lifecycle helpers", () => {
  it("allows only one active dispatch for a session in UI state", () => {
    const sessionId = "session-1";
    const queueBySession: SessionQueueMap = {
      [sessionId]: [
        buildQueuedTurn({
          id: "turn-1",
          sessionId,
          text: "first",
          kind: "normal",
        }),
        buildQueuedTurn({
          id: "turn-2",
          sessionId,
          text: "second",
          kind: "normal",
        }),
      ],
    };

    const noActive = deriveQueueDispatchState(queueBySession, sessionId, {
      hasActiveQueuedTurn: false,
      isSessionProcessing: false,
    });
    expect(noActive.shouldDispatch).toBe(true);
    expect(noActive.nextTurn?.id).toBe("turn-1");

    const withActive = deriveQueueDispatchState(queueBySession, sessionId, {
      hasActiveQueuedTurn: true,
      isSessionProcessing: false,
    });
    expect(withActive.shouldDispatch).toBe(false);
    expect(withActive.nextTurn?.id).toBe("turn-1");
  });

  it("applies steer success path by removing the settled turn and keeping queue running", () => {
    const sessionId = "session-1";
    const queueBySession: SessionQueueMap = {
      [sessionId]: [
        buildQueuedTurn({
          id: "steer-1",
          sessionId,
          text: "steer turn",
          kind: "steer",
          expectedTurnId: "turn-active-1",
        }),
        buildQueuedTurn({
          id: "normal-1",
          sessionId,
          text: "normal turn",
          kind: "normal",
        }),
      ],
    };

    const next = applyQueuedTurnTerminalOutcome({
      queueBySession,
      sessionId,
      turnId: "steer-1",
      outcome: "complete",
    });

    expect(next[sessionId].map((turn) => turn.id)).toEqual(["normal-1"]);
    expect(next[sessionId][0].status).toBe("queued");
  });

  it("preserves expectedTurnId metadata for steer queued turns", () => {
    const queued = buildQueuedTurn({
      id: "steer-with-turn",
      sessionId: "session-1",
      text: "steer next response",
      kind: "steer",
      expectedTurnId: "turn-123",
    });

    expect(queued.kind).toBe("steer");
    expect(queued.expectedTurnId).toBe("turn-123");
  });

  it("applies steer failure path by removing the settled turn and preserving queue continuity", () => {
    const sessionId = "session-1";
    const queueBySession: SessionQueueMap = {
      [sessionId]: [
        buildQueuedTurn({
          id: "steer-1",
          sessionId,
          text: "steer turn",
          kind: "steer",
        }),
        buildQueuedTurn({
          id: "normal-1",
          sessionId,
          text: "normal turn",
          kind: "normal",
        }),
      ],
    };

    const next = applyQueuedTurnTerminalOutcome({
      queueBySession,
      sessionId,
      turnId: "steer-1",
      outcome: "error",
    });

    expect(next[sessionId].map((turn) => turn.id)).toEqual(["normal-1"]);
    expect(next[sessionId][0].status).toBe("queued");
  });

  it("converges to paused queue state after interrupt-style aborted terminal outcome", () => {
    const sessionId = "session-1";
    const queueBySession: SessionQueueMap = {
      [sessionId]: [
        buildQueuedTurn({
          id: "turn-1",
          sessionId,
          text: "first",
          kind: "normal",
        }),
        buildQueuedTurn({
          id: "turn-2",
          sessionId,
          text: "second",
          kind: "normal",
        }),
      ],
    };

    const next = applyQueuedTurnTerminalOutcome({
      queueBySession,
      sessionId,
      turnId: "turn-1",
      outcome: "aborted",
    });

    expect(next[sessionId].map((turn) => turn.id)).toEqual(["turn-2"]);
    expect(next[sessionId][0].status).toBe("paused");
  });

  it("blocks dispatch for steer queued turn when expectedTurnId is missing", () => {
    const sessionId = "session-1";
    const queueBySession: SessionQueueMap = {
      [sessionId]: [
        buildQueuedTurn({
          id: "steer-missing-turn",
          sessionId,
          text: "steer without active turn",
          kind: "steer",
        }),
      ],
    };

    const state = deriveQueueDispatchState(queueBySession, sessionId, {
      hasActiveQueuedTurn: false,
      isSessionProcessing: false,
    });

    expect(state.shouldDispatch).toBe(false);
    expect(state.nextTurn).toBeNull();
  });

  it("prefers selected/routed session over stale current session when resolving codex target session", () => {
    const resolved = resolvePreferredCodexSessionId({
      selectedSessionId: "session-selected",
      routedSessionId: "session-routed",
      currentSessionId: "session-stale-current",
      pendingViewSessionId: "new-session-temp",
      pendingSessionId: "session-pending",
      lastSubmittedSessionId: "session-last",
    });

    expect(resolved).toBe("session-selected");
  });
});
