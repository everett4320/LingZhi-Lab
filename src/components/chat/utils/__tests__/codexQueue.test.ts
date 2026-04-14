import { describe, expect, it } from "vitest";

import {
  buildQueuedTurn,
  enqueueSessionTurn,
  getSessionQueue,
  getNextDispatchableTurn,
  promoteQueuedTurnToSteer,
  reconcileSessionQueueId,
  reconcileSettledSessionQueue,
  removeQueuedTurn,
  setSessionQueueStatus,
  type SessionQueueMap,
} from "../codexQueue";

describe("codexQueue", () => {
  it("keeps steer turns ahead of normal turns when enqueueing", () => {
    const sessionId = "session-1";
    const initialQueue: SessionQueueMap = {
      [sessionId]: [
        buildQueuedTurn({
          id: "normal-1",
          sessionId,
          text: "normal one",
          kind: "normal",
        }),
      ],
    };

    const next = enqueueSessionTurn(
      initialQueue,
      buildQueuedTurn({
        id: "steer-1",
        sessionId,
        text: "steer one",
        kind: "steer",
      }),
    );

    expect(next[sessionId].map((turn) => turn.id)).toEqual([
      "steer-1",
      "normal-1",
    ]);
  });

  it("keeps steer turns FIFO when enqueueing multiple steers", () => {
    const sessionId = "session-1";
    const initialQueue: SessionQueueMap = {
      [sessionId]: [
        buildQueuedTurn({
          id: "steer-1",
          sessionId,
          text: "first steer",
          kind: "steer",
        }),
        buildQueuedTurn({
          id: "normal-1",
          sessionId,
          text: "normal one",
          kind: "normal",
        }),
      ],
    };

    const next = enqueueSessionTurn(
      initialQueue,
      buildQueuedTurn({
        id: "steer-2",
        sessionId,
        text: "second steer",
        kind: "steer",
      }),
    );

    expect(next[sessionId].map((turn) => `${turn.id}:${turn.kind}`)).toEqual([
      "steer-1:steer",
      "steer-2:steer",
      "normal-1:normal",
    ]);
  });

  it("chooses a queued steer turn before normal turns", () => {
    const queue = [
      buildQueuedTurn({
        id: "normal-1",
        sessionId: "session-1",
        text: "normal one",
        kind: "normal",
      }),
      buildQueuedTurn({
        id: "steer-1",
        sessionId: "session-1",
        text: "steer one",
        kind: "steer",
      }),
    ];

    const next = getNextDispatchableTurn(queue);
    expect(next?.id).toBe("steer-1");
  });

  it("promotes a queued turn to steer and moves it to the top", () => {
    const sessionId = "session-1";
    const initialQueue: SessionQueueMap = {
      [sessionId]: [
        buildQueuedTurn({
          id: "normal-1",
          sessionId,
          text: "normal one",
          kind: "normal",
        }),
        buildQueuedTurn({
          id: "normal-2",
          sessionId,
          text: "normal two",
          kind: "normal",
        }),
      ],
    };

    const next = promoteQueuedTurnToSteer(
      initialQueue,
      sessionId,
      "normal-2",
    );

    expect(next[sessionId][0].id).toBe("normal-2");
    expect(next[sessionId][0].kind).toBe("steer");
    expect(next[sessionId][1].id).toBe("normal-1");
  });

  it("promotes a queued turn to steer after existing steer turns", () => {
    const sessionId = "session-1";
    const initialQueue: SessionQueueMap = {
      [sessionId]: [
        buildQueuedTurn({
          id: "steer-1",
          sessionId,
          text: "first steer",
          kind: "steer",
        }),
        buildQueuedTurn({
          id: "normal-1",
          sessionId,
          text: "normal one",
          kind: "normal",
        }),
        buildQueuedTurn({
          id: "normal-2",
          sessionId,
          text: "normal two",
          kind: "normal",
        }),
      ],
    };

    const next = promoteQueuedTurnToSteer(
      initialQueue,
      sessionId,
      "normal-2",
    );

    expect(next[sessionId].map((turn) => `${turn.id}:${turn.kind}`)).toEqual([
      "steer-1:steer",
      "normal-2:steer",
      "normal-1:normal",
    ]);
  });

  it("returns queued normal turn when no steer is queued", () => {
    const queue = [
      buildQueuedTurn({
        id: "paused-steer",
        sessionId: "session-1",
        text: "should not dispatch",
        kind: "steer",
        status: "paused",
      }),
      buildQueuedTurn({
        id: "normal-1",
        sessionId: "session-1",
        text: "normal one",
        kind: "normal",
        status: "queued",
      }),
    ];

    expect(getNextDispatchableTurn(queue)?.id).toBe("normal-1");
  });

  it("removes one queued turn and keeps the rest in order", () => {
    const sessionId = "session-1";
    const queueBySession: SessionQueueMap = {
      [sessionId]: [
        buildQueuedTurn({
          id: "steer-1",
          sessionId,
          text: "steer one",
          kind: "steer",
        }),
        buildQueuedTurn({
          id: "normal-1",
          sessionId,
          text: "normal one",
          kind: "normal",
        }),
        buildQueuedTurn({
          id: "normal-2",
          sessionId,
          text: "normal two",
          kind: "normal",
        }),
      ],
    };

    const next = removeQueuedTurn(queueBySession, sessionId, "normal-1");
    expect(next[sessionId].map((turn) => turn.id)).toEqual([
      "steer-1",
      "normal-2",
    ]);
  });

  it("removes session entry entirely when last queued turn is removed", () => {
    const sessionId = "session-1";
    const queueBySession: SessionQueueMap = {
      [sessionId]: [
        buildQueuedTurn({
          id: "only-turn",
          sessionId,
          text: "only turn",
          kind: "normal",
        }),
      ],
    };

    const next = removeQueuedTurn(queueBySession, sessionId, "only-turn");
    expect(next[sessionId]).toBeUndefined();
    expect(Object.keys(next)).toHaveLength(0);
  });

  it("sets queue status for all turns in one session", () => {
    const sessionId = "session-1";
    const queueBySession: SessionQueueMap = {
      [sessionId]: [
        buildQueuedTurn({
          id: "turn-1",
          sessionId,
          text: "turn one",
          kind: "normal",
          status: "queued",
        }),
        buildQueuedTurn({
          id: "turn-2",
          sessionId,
          text: "turn two",
          kind: "steer",
          status: "queued",
        }),
      ],
    };

    const paused = setSessionQueueStatus(queueBySession, sessionId, "paused");
    expect(paused[sessionId].every((turn) => turn.status === "paused")).toBe(
      true,
    );
  });

  it("keeps object identity when setting status on an empty session queue", () => {
    const queueBySession: SessionQueueMap = {};
    const next = setSessionQueueStatus(queueBySession, "missing-session", "paused");
    expect(next).toBe(queueBySession);
  });

  it("reconciles temporary session queue into settled session preserving settled-first order", () => {
    const queueBySession: SessionQueueMap = {
      "session-settled": [
        buildQueuedTurn({
          id: "settled-1",
          sessionId: "session-settled",
          text: "already settled",
          kind: "normal",
        }),
      ],
      "new-session-123": [
        buildQueuedTurn({
          id: "temp-steer",
          sessionId: "new-session-123",
          text: "temp steer",
          kind: "steer",
        }),
        buildQueuedTurn({
          id: "temp-queue",
          sessionId: "new-session-123",
          text: "temp queue",
          kind: "normal",
        }),
      ],
    };

    const reconciled = reconcileSessionQueueId(
      queueBySession,
      "new-session-123",
      "session-settled",
    );

    expect(reconciled["new-session-123"]).toBeUndefined();
    expect(
      reconciled["session-settled"].map((turn) => `${turn.id}:${turn.sessionId}`),
    ).toEqual([
      "settled-1:session-settled",
      "temp-steer:session-settled",
      "temp-queue:session-settled",
    ]);
  });

  it("treats reconcileSessionQueueId as no-op for invalid or empty source", () => {
    const initial: SessionQueueMap = {
      "session-a": [
        buildQueuedTurn({
          id: "a-1",
          sessionId: "session-a",
          text: "a one",
          kind: "normal",
        }),
      ],
    };

    expect(reconcileSessionQueueId(initial, undefined, "session-b")).toBe(initial);
    expect(reconcileSessionQueueId(initial, "session-a", undefined)).toBe(initial);
    expect(reconcileSessionQueueId(initial, "session-a", "session-a")).toBe(initial);
    expect(
      reconcileSessionQueueId(initial, "new-session-missing", "session-b"),
    ).toBe(initial);
  });

  it("reconciles settled session only when fallback id is a temporary session id", () => {
    const withTemp: SessionQueueMap = {
      "session-live": [
        buildQueuedTurn({
          id: "live-1",
          sessionId: "session-live",
          text: "live",
          kind: "normal",
        }),
      ],
      "new-session-999": [
        buildQueuedTurn({
          id: "temp-1",
          sessionId: "new-session-999",
          text: "temp",
          kind: "normal",
        }),
      ],
    };

    const reconciled = reconcileSettledSessionQueue(
      withTemp,
      "session-live",
      "new-session-999",
    );
    expect(reconciled["new-session-999"]).toBeUndefined();
    expect(reconciled["session-live"].map((turn) => turn.id)).toEqual([
      "live-1",
      "temp-1",
    ]);

    const withNonTemp = reconcileSettledSessionQueue(
      withTemp,
      "session-live",
      "session-other",
    );
    expect(withNonTemp).toBe(withTemp);
  });

  it("preserves queue semantics when switching models within the same provider (codex 5.2 -> 5.3)", () => {
    const sessionId = "session-model-switch";
    const queueBySession: SessionQueueMap = {};

    // User started with gpt-5.2 and queued two turns while busy.
    const withFirstModel = enqueueSessionTurn(
      queueBySession,
      buildQueuedTurn({
        id: "q-1",
        sessionId,
        text: "first queued turn",
        kind: "normal",
      }),
    );
    const withSecondTurn = enqueueSessionTurn(
      withFirstModel,
      buildQueuedTurn({
        id: "q-2",
        sessionId,
        text: "second queued turn",
        kind: "normal",
      }),
    );

    // User switches Codex model to gpt-5.3 before the queue drains.
    // Queue functions are model-agnostic and must keep order intact.
    const queueAfterModelSwitch = getSessionQueue(withSecondTurn, sessionId);
    expect(queueAfterModelSwitch.map((turn) => turn.id)).toEqual(["q-1", "q-2"]);
    expect(getNextDispatchableTurn(queueAfterModelSwitch)?.id).toBe("q-1");
  });

  it("keeps steer-first order after serialization round-trip (refresh recovery)", () => {
    const sessionId = "session-refresh";
    const queueBySession: SessionQueueMap = {
      [sessionId]: [
        buildQueuedTurn({
          id: "steer-urgent",
          sessionId,
          text: "urgent steer",
          kind: "steer",
          status: "queued",
          createdAt: 1111,
        }),
        buildQueuedTurn({
          id: "queue-1",
          sessionId,
          text: "queued one",
          kind: "normal",
          status: "queued",
          createdAt: 2222,
        }),
      ],
    };

    const restored = JSON.parse(
      JSON.stringify(queueBySession),
    ) as SessionQueueMap;
    const next = getNextDispatchableTurn(getSessionQueue(restored, sessionId));
    expect(next?.id).toBe("steer-urgent");
  });

  it("preserves order under concurrent temp→settled promotions from multiple temp sessions", () => {
    const settledId = "session-settled";
    const tempA = "new-session-aaa";
    const tempB = "new-session-bbb";

    const initialQueue: SessionQueueMap = {
      [settledId]: [
        buildQueuedTurn({
          id: "settled-1",
          sessionId: settledId,
          text: "settled turn",
          kind: "normal",
        }),
      ],
      [tempA]: [
        buildQueuedTurn({
          id: "tempA-1",
          sessionId: tempA,
          text: "temp A first",
          kind: "normal",
        }),
        buildQueuedTurn({
          id: "tempA-2",
          sessionId: tempA,
          text: "temp A second",
          kind: "steer",
        }),
      ],
      [tempB]: [
        buildQueuedTurn({
          id: "tempB-1",
          sessionId: tempB,
          text: "temp B first",
          kind: "normal",
        }),
      ],
    };

    // Simulate two sequential temp→settled promotions (the order they arrive)
    const afterA = reconcileSettledSessionQueue(initialQueue, settledId, tempA);
    const afterBoth = reconcileSettledSessionQueue(afterA, settledId, tempB);

    // tempA and tempB queues should be gone
    expect(afterBoth[tempA]).toBeUndefined();
    expect(afterBoth[tempB]).toBeUndefined();

    // Settled queue should contain all turns in order:
    // existing settled → tempA turns → tempB turns
    const ids = afterBoth[settledId].map((t) => t.id);
    expect(ids).toEqual([
      "settled-1",
      "tempA-1",
      "tempA-2",
      "tempB-1",
    ]);

    // All turns should have the settled sessionId
    expect(
      afterBoth[settledId].every((t) => t.sessionId === settledId),
    ).toBe(true);

    // Steer kind should be preserved through reconciliation
    const steerTurn = afterBoth[settledId].find((t) => t.id === "tempA-2");
    expect(steerTurn?.kind).toBe("steer");
  });

  it("preserves order when promotion and reconciliation interleave", () => {
    const tempId = "new-session-xyz";
    const settledId = "session-final";

    let queue: SessionQueueMap = {
      [tempId]: [
        buildQueuedTurn({
          id: "t-1",
          sessionId: tempId,
          text: "first",
          kind: "normal",
        }),
        buildQueuedTurn({
          id: "t-2",
          sessionId: tempId,
          text: "second",
          kind: "normal",
        }),
        buildQueuedTurn({
          id: "t-3",
          sessionId: tempId,
          text: "third",
          kind: "normal",
        }),
      ],
    };

    // Promote t-3 to steer (moves to front) before reconciliation
    queue = promoteQueuedTurnToSteer(queue, tempId, "t-3");
    expect(queue[tempId].map((t) => t.id)).toEqual(["t-3", "t-1", "t-2"]);

    // Now reconcile temp → settled
    queue = reconcileSettledSessionQueue(queue, settledId, tempId);

    expect(queue[tempId]).toBeUndefined();
    const ids = queue[settledId].map((t) => t.id);
    // Promoted steer turn stays at front, then remaining in original order
    expect(ids).toEqual(["t-3", "t-1", "t-2"]);
    expect(queue[settledId][0].kind).toBe("steer");
    expect(queue[settledId].every((t) => t.sessionId === settledId)).toBe(true);
  });
});
