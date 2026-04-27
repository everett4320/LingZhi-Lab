import { describe, expect, it } from "vitest";

import {
  createCodexInputMessage,
  createEmptyCodexInputState,
  reduceCodexInputSubmit,
  reduceCodexSteerCommitted,
  reduceCodexSteerRejected,
  reduceCodexTurnCompleted,
  reduceCodexTurnAborted,
  reconcileSessionInputStateId,
  popLastQueuedMessage,
  upsertSessionInputState,
  getSessionInputState,
} from "../codexQueue";

describe("codexQueue reducer utilities", () => {
  it("queues follow-up messages locally without dispatch", () => {
    const message = createCodexInputMessage({ id: "q1", text: "next task" });
    const result = reduceCodexInputSubmit(createEmptyCodexInputState(), message, "queue");

    expect(result.resolution.action).toBe("queued");
    expect(result.state.queuedUserMessages).toHaveLength(1);
    expect(result.state.pendingSteers).toHaveLength(0);
  });

  it("marks steer as pending then removes it on commit compareKey", () => {
    const steer = createCodexInputMessage({
      id: "s1",
      text: "adjust result",
      localImages: ["/tmp/a.png"],
      mentionBindings: [{ path: "src/a.ts" }],
    });

    const submitted = reduceCodexInputSubmit(createEmptyCodexInputState(), steer, "steer");
    expect(submitted.resolution.action).toBe("steer");
    expect(submitted.state.pendingSteers).toHaveLength(1);

    const committed = reduceCodexSteerCommitted(submitted.state, {
      text: "adjust result",
      localImagesCount: 1,
      remoteImageUrlsCount: 0,
      mentionBindingsCount: 1,
      documentCount: 0,
    });

    expect(committed.pendingSteers).toHaveLength(0);
  });

  it("moves rejected steer into rejectedSteersQueue", () => {
    const steer = createCodexInputMessage({
      id: "s2",
      clientTurnId: "client-2",
      text: "rejectable steer",
    });

    const submitted = reduceCodexInputSubmit(createEmptyCodexInputState(), steer, "steer");
    const rejected = reduceCodexSteerRejected(submitted.state, {
      clientTurnId: "client-2",
      turnKind: "steer",
      rejectedAt: Date.now(),
    });

    expect(rejected.pendingSteers).toHaveLength(0);
    expect(rejected.rejectedSteersQueue).toHaveLength(1);
    expect(rejected.rejectedSteersQueue[0].text).toBe("rejectable steer");
  });

  it("turn complete prioritizes merged rejected steers before queued follows", () => {
    const state = {
      ...createEmptyCodexInputState(),
      rejectedSteersQueue: [
        createCodexInputMessage({ id: "r1", text: "r-one" }),
        createCodexInputMessage({ id: "r2", text: "r-two" }),
      ],
      queuedUserMessages: [createCodexInputMessage({ id: "q1", text: "q-one" })],
      taskRunning: true,
    };

    const settled = reduceCodexTurnCompleted(state);
    expect(settled.resolution.action).toBe("dispatch-merge-start");
    expect(settled.state.rejectedSteersQueue).toHaveLength(0);
  });

  it("turn abort merges unsent content back to composer when not interrupting for pending steer", () => {
    const state = {
      ...createEmptyCodexInputState(),
      rejectedSteersQueue: [createCodexInputMessage({ id: "r", text: "r" })],
      pendingSteers: [createCodexInputMessage({ id: "p", text: "p" })],
      queuedUserMessages: [createCodexInputMessage({ id: "q", text: "q" })],
      composerDraft: createCodexInputMessage({ id: "d", text: "d" }),
      taskRunning: true,
    };

    const aborted = reduceCodexTurnAborted(state, { interruptForPendingSteers: false });
    expect(aborted.resolution.action).toBe("dispatch-none");
    expect(aborted.state.composerDraft?.text).toContain("r");
    expect(aborted.state.composerDraft?.text).toContain("p");
    expect(aborted.state.composerDraft?.text).toContain("q");
    expect(aborted.state.composerDraft?.text).toContain("d");
  });

  it("reconciles provisional session state into resolved session id", () => {
    let map = {};
    map = upsertSessionInputState(map, "new-session-1", {
      ...createEmptyCodexInputState(),
      queuedUserMessages: [createCodexInputMessage({ id: "q1", text: "queued" })],
    });

    const reconciled = reconcileSessionInputStateId(map, "new-session-1", "session-1");
    const state = getSessionInputState(reconciled, "session-1");
    expect(state.queuedUserMessages).toHaveLength(1);
    expect(reconciled["new-session-1"]).toBeUndefined();
  });

  it("restores last queued message into composer draft", () => {
    const state = {
      ...createEmptyCodexInputState(),
      queuedUserMessages: [
        createCodexInputMessage({ id: "q1", text: "first" }),
        createCodexInputMessage({ id: "q2", text: "second" }),
      ],
    };

    const popped = popLastQueuedMessage(state);
    expect(popped.popped?.id).toBe("q2");
    expect(popped.state.composerDraft?.id).toBe("q2");
    expect(popped.state.queuedUserMessages).toHaveLength(1);
  });
});
