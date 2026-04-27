import { describe, expect, it } from "vitest";

import { resolvePreferredCodexSessionId } from "../useChatComposerState";
import {
  createCodexInputMessage,
  createEmptyCodexInputState,
  reduceCodexInputSubmit,
  reduceCodexSteerCommitted,
  reduceCodexSteerRejected,
  reduceCodexTurnCompleted,
  reduceCodexTurnAborted,
} from "../../utils/codexQueue";

describe("useChatComposerState reducer semantics", () => {
  it("moves steer from pending preview after committed compareKey", () => {
    const base = createEmptyCodexInputState();
    const steer = createCodexInputMessage({
      id: "steer-1",
      text: "please adjust output",
      localImages: ["/tmp/a.png"],
      mentionBindings: [{ path: "src/a.ts" }],
    });

    const submitted = reduceCodexInputSubmit(base, steer, "steer");
    expect(submitted.state.pendingSteers).toHaveLength(1);

    const committed = reduceCodexSteerCommitted(submitted.state, {
      text: "please adjust output",
      localImagesCount: 1,
      remoteImageUrlsCount: 0,
      mentionBindingsCount: 1,
      documentCount: 0,
    });

    expect(committed.pendingSteers).toHaveLength(0);
  });

  it("moves rejected steer to rejected queue", () => {
    const steer = createCodexInputMessage({
      id: "steer-2",
      clientTurnId: "ct-2",
      text: "follow this constraint",
    });

    const submitted = reduceCodexInputSubmit(createEmptyCodexInputState(), steer, "steer");
    const rejected = reduceCodexSteerRejected(submitted.state, {
      clientTurnId: "ct-2",
      turnKind: "steer",
      rejectedAt: Date.now(),
    });

    expect(rejected.pendingSteers).toHaveLength(0);
    expect(rejected.rejectedSteersQueue).toHaveLength(1);
    expect(rejected.rejectedSteersQueue[0].text).toBe("follow this constraint");
  });

  it("turn complete prioritizes rejected steers over queued follow-up", () => {
    const state = {
      ...createEmptyCodexInputState(),
      rejectedSteersQueue: [
        createCodexInputMessage({ id: "r1", text: "rejected one" }),
        createCodexInputMessage({ id: "r2", text: "rejected two" }),
      ],
      queuedUserMessages: [
        createCodexInputMessage({ id: "q1", text: "queued one" }),
      ],
      taskRunning: true,
    };

    const settled = reduceCodexTurnCompleted(state);
    expect(settled.resolution.action).toBe("dispatch-merge-start");
    if (settled.resolution.action === "dispatch-merge-start") {
      expect(settled.resolution.merged.text).toContain("rejected one");
      expect(settled.resolution.merged.text).toContain("rejected two");
    }
    expect(settled.state.rejectedSteersQueue).toHaveLength(0);
  });

  it("turn aborted without interrupt restores all unsent content to composer draft", () => {
    const state = {
      ...createEmptyCodexInputState(),
      rejectedSteersQueue: [createCodexInputMessage({ id: "r1", text: "r" })],
      pendingSteers: [createCodexInputMessage({ id: "p1", text: "p" })],
      queuedUserMessages: [createCodexInputMessage({ id: "q1", text: "q" })],
      composerDraft: createCodexInputMessage({ id: "d1", text: "d" }),
      taskRunning: true,
    };

    const aborted = reduceCodexTurnAborted(state, { interruptForPendingSteers: false });
    expect(aborted.resolution.action).toBe("dispatch-none");
    expect(aborted.state.composerDraft?.text).toContain("r");
    expect(aborted.state.composerDraft?.text).toContain("p");
    expect(aborted.state.composerDraft?.text).toContain("q");
    expect(aborted.state.composerDraft?.text).toContain("d");
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
