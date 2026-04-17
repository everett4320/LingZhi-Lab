import { useEffect, useRef } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import {
  buildAssistantMessages,
  decodeHtmlEntities,
  formatUsageLimitText,
  unescapeWithMathProtection,
} from "../utils/chatFormatting";
import {
  parseAskUserAnswers,
  mergeAnswersIntoToolInput,
} from "../utils/messageTransforms";
import {
  buildChatMessagesStorageKey,
  clearScopedPendingSessionId,
  clearSessionTimerStart,
  moveSessionTimerStart,
  persistSessionTimerStart,
  persistScopedPendingSessionId,
  readScopedPendingSessionId,
  safeLocalStorage,
} from "../utils/chatStorage";
import {
  emitSessionFilterDebugLog,
  syncSessionFilterDebugSetting,
} from "../utils/sessionFilterDebug";
import { invalidateSessionMessageCache } from './useChatSessionState';
import { RESUMING_STATUS_TEXT } from "../types/types";
import i18n from "../../../i18n/config";
import type { ChatMessage, PendingPermissionRequest } from "../types/types";
import type {
  Project,
  ProjectSession,
  SessionNavigationSource,
  SessionProvider,
} from "../../../types/app";
import { isProviderAllowed, normalizeProvider } from "../../../utils/providerPolicy";

type PendingViewSession = {
  sessionId: string | null;
  startedAt: number;
};

type LatestChatMessage = {
  type?: string;
  data?: any;
  scope?: { projectName?: string; provider?: string; sessionId?: string } | null;
  sessionId?: string;
  requestId?: string;
  toolName?: string;
  input?: unknown;
  context?: unknown;
  error?: string;
  tool?: string;
  exitCode?: number;
  isProcessing?: boolean;
  actualSessionId?: string;
  [key: string]: any;
};

const CODEX_REALTIME_MESSAGE_TYPES = new Set<string>([
  "projects_updated",
  "taskmaster-project-updated",
  "session-created",
  "session-aborted",
  "session-status",
  "session-accepted",
  "session-busy",
  "session-state-changed",
  "chat-session-created",
  "chat-session-upsert",
  "chat-turn-accepted",
  "chat-turn-delta",
  "chat-turn-item",
  "chat-turn-complete",
  "chat-turn-error",
  "chat-turn-aborted",
  "chat-sidebar-remove",
  "token-budget",
]);

export const isCodexRealtimeMessageSupported = (
  message:
    | {
        type?: unknown;
        provider?: unknown;
        scope?: { provider?: unknown } | null;
      }
    | null
    | undefined,
): boolean => {
  if (!message || typeof message !== "object") {
    return false;
  }

  const messageType = typeof message.type === "string" ? message.type : "";
  if (!CODEX_REALTIME_MESSAGE_TYPES.has(messageType)) {
    return false;
  }

  const providerCandidate =
    typeof message.provider === "string"
      ? message.provider
      : message.scope &&
          typeof message.scope === "object" &&
          typeof message.scope.provider === "string"
        ? message.scope.provider
        : null;

  if (!providerCandidate) {
    return true;
  }

  return providerCandidate.trim().toLowerCase() === "codex";
};

const warnedUnknownProviders = new Set<string>();

interface UseChatRealtimeHandlersArgs {
  latestMessage: LatestChatMessage | null;
  provider: SessionProvider;
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  setCurrentSessionId: (sessionId: string | null) => void;
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setIsLoading: (loading: boolean) => void;
  setCanAbortSession: (canAbort: boolean) => void;
  setClaudeStatus: Dispatch<
    SetStateAction<{
      text: string;
      tokens: number;
      can_interrupt: boolean;
      startTime?: number;
    } | null>
  >;
  setStatusTextOverride: Dispatch<SetStateAction<string | null>>;
  setTokenBudget: (budget: Record<string, unknown> | null) => void;
  setIsSystemSessionChange: (isSystemSessionChange: boolean) => void;
  setPendingPermissionRequests: Dispatch<
    SetStateAction<PendingPermissionRequest[]>
  >;
  pendingViewSessionRef: MutableRefObject<PendingViewSession | null>;
  streamBufferRef: MutableRefObject<string>;
  streamTimerRef: MutableRefObject<number | null>;
  onSessionInactive?: (
    sessionId?: string | null,
    provider?: SessionProvider | null,
    projectName?: string | null,
  ) => void;
  onSessionProcessing?: (
    sessionId?: string | null,
    provider?: SessionProvider | null,
    projectName?: string | null,
  ) => void;
  onSessionNotProcessing?: (
    sessionId?: string | null,
    provider?: SessionProvider | null,
    projectName?: string | null,
  ) => void;
  onSessionStatusResolved?: (
    sessionId?: string | null,
    isProcessing?: boolean,
  ) => void;
  onCodexTurnStarted?: (sessionId?: string | null) => void;
  onCodexTurnSettled?: (
    sessionId?: string | null,
    outcome?: "complete" | "error" | "aborted",
  ) => void;
  onCodexSessionBusy?: (sessionId?: string | null) => void;
  onCodexSessionIdResolved?: (
    previousSessionId?: string | null,
    actualSessionId?: string | null,
  ) => void;
  onReplaceTemporarySession?: (
    sessionId?: string | null,
    provider?: SessionProvider | null,
    projectName?: string | null,
    previousSessionId?: string | null,
  ) => void;
  onNavigateToSession?: (
    sessionId: string,
    sessionProvider?: SessionProvider,
    targetProjectName?: string,
    options?: { source?: SessionNavigationSource },
  ) => void;
  sendMessage?: (message: Record<string, unknown>) => void;
}

type FinalizeSessionLifecycleOptions = {
  projectName?: string | null;
  clearSessionTimerStart?: (sessionId: string) => void;
  onSessionInactive?: (sessionId?: string | null) => void;
  onSessionNotProcessing?: (sessionId?: string | null) => void;
  onSessionStatusResolved?: (sessionId?: string | null, isProcessing?: boolean) => void;
  invalidateSessionCache?: (projectName: string, sessionId: string) => void;
};

export function finalizeSessionLifecycle(
  sessionIds: Array<string | null | undefined>,
  {
    projectName,
    clearSessionTimerStart: clearTimer = clearSessionTimerStart,
    onSessionInactive,
    onSessionNotProcessing,
    onSessionStatusResolved,
    invalidateSessionCache = invalidateSessionMessageCache,
  }: FinalizeSessionLifecycleOptions,
) {
  const normalizedSessionIds = Array.from(
    new Set(
      sessionIds.filter((sessionId): sessionId is string => typeof sessionId === 'string' && sessionId.length > 0),
    ),
  );

  normalizedSessionIds.forEach((sessionId) => {
    clearTimer(sessionId);
    onSessionInactive?.(sessionId);
    onSessionNotProcessing?.(sessionId);
    onSessionStatusResolved?.(sessionId, false);
    if (projectName) {
      invalidateSessionCache(projectName, sessionId);
    }
  });
}

const isLegacyTaskMasterInstallError = (value: unknown): boolean => {
  const normalized = String(value || "").toLowerCase();
  if (!normalized.includes("taskmaster")) {
    return false;
  }

  return (
    normalized.includes("not installed") ||
    normalized.includes("not configured")
  );
};

export function useChatRealtimeHandlers({
  latestMessage,
  provider,
  selectedProject,
  selectedSession,
  currentSessionId,
  setCurrentSessionId,
  setChatMessages,
  setIsLoading,
  setCanAbortSession,
  setClaudeStatus,
  setStatusTextOverride,
  setTokenBudget,
  setIsSystemSessionChange,
  setPendingPermissionRequests,
  pendingViewSessionRef,
  streamBufferRef,
  streamTimerRef,
  onSessionInactive,
  onSessionProcessing,
  onSessionNotProcessing,
  onSessionStatusResolved,
  onCodexTurnStarted,
  onCodexTurnSettled,
  onCodexSessionBusy,
  onCodexSessionIdResolved,
  onReplaceTemporarySession,
  onNavigateToSession,
  sendMessage,
}: UseChatRealtimeHandlersArgs) {
  const lastProcessedMessageRef = useRef<LatestChatMessage | null>(null);

  useEffect(() => {
    syncSessionFilterDebugSetting(sendMessage);
  }, [sendMessage]);

  // Helper: Handle structured assistant content
  const handleStructuredAssistantMessage = (
    structuredData: any,
    rawData: any,
  ) => {
    // New assistant message = previous tool execution done; clear override.
    // If this message contains a new Bash tool_use, it will be re-set below (React batches both updates).
    setStatusTextOverride(null);

    const parentToolUseId = rawData?.parentToolUseId;
    const newMessages: any[] = [];
    const childToolUpdates: { parentId: string; child: any }[] = [];

    structuredData.content.forEach((part: any) => {
      if (part.type === "thinking" || part.type === "reasoning") {
        const thinkingText = part.thinking || part.reasoning || part.text || "";
        if (thinkingText.trim()) {
          newMessages.push({
            type: "assistant",
            content: unescapeWithMathProtection(thinkingText),
            timestamp: new Date(),
            isThinking: true,
            isStreaming: true,
          });
        }
        return;
      }

      if (part.type === "tool_use") {
        if (["Bash", "run_shell_command"].includes(part.name)) {
          // Set running code status when command starts
          setStatusTextOverride(i18n.t("chat:status.runningCode"));
        }
        const toolInput = part.input ? JSON.stringify(part.input, null, 2) : "";

        if (parentToolUseId) {
          childToolUpdates.push({
            parentId: parentToolUseId,
            child: {
              toolId: part.id,
              toolName: part.name,
              toolInput: part.input,
              toolResult: null,
              timestamp: new Date(),
            },
          });
          return;
        }

        const isSubagentContainer = part.name === "Task";
        newMessages.push({
          type: "assistant",
          content: "",
          timestamp: new Date(),
          isToolUse: true,
          toolName: part.name,
          toolInput,
          toolId: part.id,
          toolResult: null,
          isSubagentContainer,
          subagentState: isSubagentContainer
            ? { childTools: [], currentToolIndex: -1, isComplete: false }
            : undefined,
        });
        return;
      }

      if (part.type === "text" && part.text?.trim()) {
        let content = decodeHtmlEntities(part.text);
        content = formatUsageLimitText(content);
        newMessages.push(...buildAssistantMessages(content, new Date()));
      }
    });

    if (newMessages.length > 0 || childToolUpdates.length > 0) {
      setChatMessages((previous) => {
        let updated = previous;
        if (childToolUpdates.length > 0) {
          updated = updated.map((message) => {
            if (!message.isSubagentContainer) return message;
            const updates = childToolUpdates.filter(
              (u) => u.parentId === message.toolId,
            );
            if (updates.length === 0) return message;
            const existingChildren = message.subagentState?.childTools || [];
            const newChildren = updates.map((u) => u.child);
            return {
              ...message,
              subagentState: {
                childTools: [...existingChildren, ...newChildren],
                currentToolIndex:
                  existingChildren.length + newChildren.length - 1,
                isComplete: false,
              },
            };
          });
        }
        if (newMessages.length > 0) {
          updated = [...updated, ...newMessages];
        }
        return updated;
      });
    }
  };

  // Helper: Handle simple text assistant message
  const handleSimpleAssistantMessage = (structuredData: any) => {
    let content = decodeHtmlEntities(structuredData.content);
    content = formatUsageLimitText(content);

    setChatMessages((previous) => [
      ...previous,
      ...buildAssistantMessages(content, new Date()),
    ]);
  };

  // Helper: Handle user tool results
  const handleUserToolResults = (structuredData: any, rawData: any) => {
    const parentToolUseId = rawData?.parentToolUseId;
    const toolResults = structuredData.content.filter(
      (part: any) => part.type === "tool_result",
    );
    const textParts = structuredData.content.filter(
      (part: any) => part.type === "text",
    );

    if (textParts.length > 0) {
      const textContent = textParts.map((p: any) => p.text || "").join("\n");
      const isSkillText =
        textContent.includes("Base directory for this skill:") ||
        textContent.startsWith("<command-name>") ||
        textContent.startsWith("<command-message>") ||
        textContent.startsWith("<command-args>") ||
        textContent.startsWith("<local-command-stdout>") ||
        (toolResults.length > 0 &&
          !textContent.startsWith("<system-reminder>"));
      if (isSkillText && textContent.trim()) {
        setChatMessages((previous) => [
          ...previous,
          {
            type: "user",
            content: textContent,
            timestamp: new Date(),
            isSkillContent: true,
          },
        ]);
      }
    }

    if (toolResults.length > 0) {
      // Reset "running code" status when tool results arrive (tool execution finished)
      setStatusTextOverride(null);

      setChatMessages((previous) =>
        previous.map((message) => {
          for (const part of toolResults) {
            if (
              parentToolUseId &&
              message.toolId === parentToolUseId &&
              message.isSubagentContainer
            ) {
              const updatedChildren = message.subagentState!.childTools.map(
                (child: any) => {
                  if (child.toolId === part.tool_use_id) {
                    return {
                      ...child,
                      toolResult: {
                        content: part.content,
                        isError: part.is_error,
                        timestamp: new Date(),
                      },
                    };
                  }
                  return child;
                },
              );
              if (updatedChildren !== message.subagentState!.childTools) {
                return {
                  ...message,
                  subagentState: {
                    ...message.subagentState!,
                    childTools: updatedChildren,
                  },
                };
              }
            }

            if (message.isToolUse && message.toolId === part.tool_use_id) {
              const result: any = {
                ...message,
                toolResult: {
                  content: part.content,
                  isError: part.is_error,
                  timestamp: new Date(),
                },
              };
              if (message.toolName === "AskUserQuestion" && part.content) {
                const resultStr =
                  typeof part.content === "string"
                    ? part.content
                    : JSON.stringify(part.content);
                const parsedAnswers = parseAskUserAnswers(resultStr);
                if (parsedAnswers) {
                  const inputStr = typeof message.toolInput === 'string'
                    ? message.toolInput
                    : JSON.stringify(message.toolInput || {});
                  result.toolInput = mergeAnswersIntoToolInput(inputStr, parsedAnswers);
                }
              }
              if (message.isSubagentContainer && message.subagentState) {
                result.subagentState = {
                  ...message.subagentState,
                  isComplete: true,
                };
              }
              return result;
            }
          }
          return message;
        }),
      );
    }
  };

  useEffect(() => {
    if (!latestMessage) {
      return;
    }

    const messageScope =
      latestMessage.scope && typeof latestMessage.scope === "object"
        ? latestMessage.scope
        : null;
    const normalizedLatestMessage: LatestChatMessage = {
      ...latestMessage,
      provider:
        typeof latestMessage.provider === "string"
          ? latestMessage.provider
          : typeof messageScope?.provider === "string"
            ? messageScope.provider
            : "codex",
      projectName:
        typeof latestMessage.projectName === "string" &&
        latestMessage.projectName.length > 0
          ? latestMessage.projectName
          : typeof messageScope?.projectName === "string"
            ? messageScope.projectName
            : null,
      sessionId:
        typeof latestMessage.sessionId === "string" &&
        latestMessage.sessionId.length > 0
          ? latestMessage.sessionId
          : typeof messageScope?.sessionId === "string"
            ? messageScope.sessionId
            : undefined,
    };

    if (lastProcessedMessageRef.current === latestMessage) {
      emitSessionFilterDebugLog(
        {
          reason: "dropped:duplicate-message-reference",
          messageType: String(normalizedLatestMessage.type || ""),
          routedSessionId: normalizedLatestMessage.actualSessionId || normalizedLatestMessage.sessionId || null,
          actualSessionId: normalizedLatestMessage.actualSessionId || null,
        },
        sendMessage,
      );
      return;
    }
    lastProcessedMessageRef.current = latestMessage;

    if (!isCodexRealtimeMessageSupported(latestMessage)) {
      emitSessionFilterDebugLog(
        {
          reason: "dropped:unsupported-non-codex-event",
          messageType: String(normalizedLatestMessage.type || ""),
          routedSessionId:
            normalizedLatestMessage.actualSessionId || normalizedLatestMessage.sessionId || null,
          actualSessionId: normalizedLatestMessage.actualSessionId || null,
          sessionProvider:
            typeof normalizedLatestMessage.provider === "string"
              ? normalizedLatestMessage.provider
              : null,
        },
        sendMessage,
      );
      return;
    }

    const messageData =
      normalizedLatestMessage.data?.message || normalizedLatestMessage.data;
    const structuredMessageData =
      messageData && typeof messageData === "object"
        ? (messageData as Record<string, any>)
        : null;

    const globalMessageTypes = [
      "projects_updated",
      "taskmaster-project-updated",
      "session-created",
      "session-aborted",
      "session-status",
      "session-accepted",
      "session-busy",
      "session-state-changed",
    ];
    const isGlobalMessage = globalMessageTypes.includes(
      String(normalizedLatestMessage.type),
    );
    const lifecycleMessageTypes = new Set([
      "chat-turn-complete",
      "session-aborted",
      "chat-turn-error",
    ]);

    const isCodexSystemInit =
      normalizedLatestMessage.type === "chat-turn-item" &&
      structuredMessageData &&
      structuredMessageData.type === "system" &&
      structuredMessageData.subtype === "init";

    const systemInitSessionId = isCodexSystemInit
      ? structuredMessageData?.session_id
      : null;

    const activeViewSessionId =
      selectedSession?.id ||
      currentSessionId ||
      pendingViewSessionRef.current?.sessionId ||
      null;
    const pendingViewSessionId = pendingViewSessionRef.current?.sessionId || null;
    const inferredMessageProvider = (() => {
      const messageType = String(normalizedLatestMessage.type || "");
      if (messageType.startsWith("chat-")) return "codex";
      if (
        messageType === "session-created" ||
        messageType === "session-status" ||
        messageType === "session-aborted" ||
        messageType === "session-accepted" ||
        messageType === "session-busy" ||
        messageType === "session-state-changed"
      ) {
        return typeof normalizedLatestMessage.provider === "string"
          ? (normalizedLatestMessage.provider as SessionProvider)
          : null;
      }
      return null;
    })();
    const resolveProvider = (
      providerValue?: string | null,
      fallback?: SessionProvider | null,
    ): SessionProvider => {
      const candidate =
        typeof providerValue === "string" && providerValue.length > 0
          ? providerValue
          : fallback || inferredMessageProvider || provider;

      if (typeof candidate === "string") {
        const normalizedCandidate = candidate.trim().toLowerCase();
        if (
          normalizedCandidate &&
          !isProviderAllowed(normalizedCandidate) &&
          !warnedUnknownProviders.has(normalizedCandidate)
        ) {
          warnedUnknownProviders.add(normalizedCandidate);
          console.warn(
            `[chat] Unknown provider "${candidate}" on message type "${String(normalizedLatestMessage.type || "")}", falling back to default provider`,
          );
        }
      }

      return normalizeProvider(candidate as SessionProvider);
    };
    const resolveProjectName = (
      projectNameValue?: string | null,
    ): string | null => {
      if (typeof projectNameValue === "string" && projectNameValue.length > 0) {
        return projectNameValue;
      }
      return selectedProject?.name || selectedSession?.__projectName || null;
    };
    const latestMessageProvider = resolveProvider(
      typeof normalizedLatestMessage.provider === "string"
        ? normalizedLatestMessage.provider
        : null,
    );
    const latestMessageProjectName = resolveProjectName(
      typeof normalizedLatestMessage.projectName === "string"
        ? normalizedLatestMessage.projectName
        : null,
    );
    const activeViewProvider = resolveProvider(
      selectedSession?.__provider || provider,
      provider,
    );
    const activeViewProjectName =
      selectedSession?.__projectName || selectedProject?.name || null;
    const routedMessageSessionId =
      normalizedLatestMessage.actualSessionId ||
      normalizedLatestMessage.sessionId ||
      null;
    const routedMessageProvisionalSessionId =
      typeof normalizedLatestMessage.provisionalSessionId === "string" &&
      normalizedLatestMessage.provisionalSessionId.length > 0
        ? normalizedLatestMessage.provisionalSessionId
        : null;
    const temporaryActiveSessionId =
      activeViewSessionId?.startsWith("new-session-")
        ? activeViewSessionId
        : null;
    const pendingViewTemporarySessionId =
      pendingViewSessionRef.current?.sessionId?.startsWith("new-session-")
        ? pendingViewSessionRef.current.sessionId
        : null;
    const expectedTemporarySessionId =
      temporaryActiveSessionId || pendingViewTemporarySessionId;
    const matchesExpectedTemporarySession =
      Boolean(
        expectedTemporarySessionId &&
          (
            routedMessageProvisionalSessionId === expectedTemporarySessionId
            || normalizedLatestMessage.sessionId === expectedTemporarySessionId
          ),
      );
    const shouldRebindTemporarySession =
      Boolean(
        expectedTemporarySessionId &&
          inferredMessageProvider === "codex" &&
          routedMessageSessionId &&
          routedMessageSessionId !== expectedTemporarySessionId &&
          matchesExpectedTemporarySession,
      ) && !selectedSession?.id;

    if (
      shouldRebindTemporarySession &&
      expectedTemporarySessionId &&
      routedMessageSessionId
    ) {
      if (inferredMessageProvider === "codex") {
        onCodexSessionIdResolved?.(
          expectedTemporarySessionId,
          routedMessageSessionId,
        );
      }
      onReplaceTemporarySession?.(
        routedMessageSessionId,
        "codex",
        latestMessageProjectName,
        expectedTemporarySessionId,
      );

      if (pendingViewSessionRef.current?.sessionId === expectedTemporarySessionId) {
        pendingViewSessionRef.current = {
          ...pendingViewSessionRef.current,
          sessionId: routedMessageSessionId,
        };
      }

      if (currentSessionId === expectedTemporarySessionId) {
        setCurrentSessionId(routedMessageSessionId);
      }
    }

    const isSystemInitForView =
      systemInitSessionId &&
      (!activeViewSessionId || systemInitSessionId === activeViewSessionId);
    const isMessageInActiveScope = (
      sessionId?: string | null,
      sessionProvider: SessionProvider = latestMessageProvider,
      projectName: string | null = latestMessageProjectName,
    ): boolean => {
      if (!sessionId || !activeViewSessionId) {
        return false;
      }

      if (sessionId !== activeViewSessionId) {
        return false;
      }

      if (sessionProvider !== activeViewProvider) {
        return false;
      }

      if (
        activeViewProjectName &&
        projectName &&
        activeViewProjectName !== projectName
      ) {
        return false;
      }

      return true;
    };
    const shouldBypassSessionFilter =
      isGlobalMessage ||
      Boolean(isSystemInitForView) ||
      shouldRebindTemporarySession;
    const isUnscopedError =
      !normalizedLatestMessage.sessionId &&
      pendingViewSessionRef.current &&
      (!pendingViewSessionId ||
        pendingViewSessionId.startsWith("new-session-")) &&
      normalizedLatestMessage.type === "chat-turn-error";
    const logFilterDecision = (reason: string, extra: Record<string, unknown> = {}) => {
      emitSessionFilterDebugLog(
        {
          reason,
          messageType: String(normalizedLatestMessage.type || ""),
          routedSessionId: routedMessageSessionId,
          actualSessionId: normalizedLatestMessage.actualSessionId || null,
          sessionProvider: latestMessageProvider,
          messageProjectName: latestMessageProjectName,
          activeViewSessionId,
          activeViewProvider,
          activeViewProjectName,
          isGlobalMessage,
          isPendingViewSession: Boolean(pendingViewSessionRef.current),
          shouldRebindTemporarySession,
          expectedTemporarySessionId,
          routedMessageProvisionalSessionId,
          isUnscopedError: Boolean(isUnscopedError),
          shouldBypassSessionFilter: Boolean(shouldBypassSessionFilter),
          extra,
        },
        sendMessage,
      );
    };

    if (normalizedLatestMessage.type === "chat-turn-complete") {
      const completedSessionId =
        normalizedLatestMessage.sessionId || currentSessionId || null;
      const actualSessionId =
        normalizedLatestMessage.actualSessionId || completedSessionId;
      if (
        currentSessionId &&
        currentSessionId.startsWith("new-session-") &&
        actualSessionId &&
        currentSessionId !== actualSessionId
      ) {
        onCodexSessionIdResolved?.(currentSessionId, actualSessionId);
      }
      if (
        completedSessionId &&
        actualSessionId &&
        completedSessionId !== actualSessionId
      ) {
        onCodexSessionIdResolved?.(completedSessionId, actualSessionId);
      }
      onCodexTurnSettled?.(actualSessionId || completedSessionId, "complete");
    } else if (normalizedLatestMessage.type === "chat-turn-error") {
      onCodexTurnSettled?.(
        routedMessageSessionId || currentSessionId || null,
        "error",
      );
    } else if (
      normalizedLatestMessage.type === "session-aborted" &&
      normalizedLatestMessage.provider === "codex"
    ) {
      onCodexTurnSettled?.(
        routedMessageSessionId || currentSessionId || null,
        "aborted",
      );
    }

    if (
      routedMessageSessionId &&
      (
        normalizedLatestMessage.type === "chat-turn-accepted" ||
        (
          normalizedLatestMessage.type === "chat-turn-item" &&
          normalizedLatestMessage.lifecycle === "started"
        )
      )
    ) {
        onCodexTurnStarted?.(routedMessageSessionId);
    }

    const notifySessionProcessing = (
      sessionId?: string | null,
      sessionProvider: SessionProvider = latestMessageProvider,
      projectName: string | null = latestMessageProjectName,
    ) => {
      onSessionProcessing?.(sessionId, sessionProvider, projectName);
      onSessionStatusResolved?.(sessionId, true);
    };

    const notifySessionCompleted = (
      sessionId?: string | null,
      sessionProvider: SessionProvider = latestMessageProvider,
      projectName: string | null = latestMessageProjectName,
    ) => {
      onSessionInactive?.(sessionId, sessionProvider, projectName);
      onSessionNotProcessing?.(sessionId, sessionProvider, projectName);
      onSessionStatusResolved?.(sessionId, false);
    };

    const clearScopedMessageCache = (
      sessionId?: string | null,
      sessionProvider: SessionProvider = latestMessageProvider,
      projectName: string | null = latestMessageProjectName,
    ) => {
      const storageKey = buildChatMessagesStorageKey(
        projectName,
        sessionId,
        sessionProvider,
      );
      if (storageKey) {
        safeLocalStorage.removeItem(storageKey);
      }
    };

    const handleBackgroundLifecycle = (sessionId?: string) => {
      if (!sessionId) {
        return;
      }
      clearSessionTimerStart(sessionId);
      notifySessionCompleted(sessionId, latestMessageProvider, latestMessageProjectName);
      finalizeSessionLifecycle([sessionId], {
        projectName: selectedProject?.name,
        onSessionInactive,
        onSessionNotProcessing,
        onSessionStatusResolved,
      });
    };

    const getLifecycleSessionIds = () => {
      const ids: string[] = [];
      if (normalizedLatestMessage.sessionId) {
        ids.push(normalizedLatestMessage.sessionId);
      }

      if (
        normalizedLatestMessage.actualSessionId &&
        normalizedLatestMessage.actualSessionId !== normalizedLatestMessage.sessionId
      ) {
        ids.push(normalizedLatestMessage.actualSessionId);
      }

      return [...new Set(ids)];
    };

    const persistStartTime = (
      startTime?: number | null,
      ...sessionIds: Array<string | null | undefined>
    ) => {
      if (!Number.isFinite(startTime)) {
        return;
      }

      const targetSessionId = sessionIds.find(
        (sessionId): sessionId is string =>
          typeof sessionId === "string" && sessionId.length > 0,
      );
      if (!targetSessionId) {
        return;
      }

      persistSessionTimerStart(targetSessionId, startTime);
    };

    const syncClaudeStatusStartTime = (
      startTime?: number | null,
      fallbackText = "Processing",
    ) => {
      if (!Number.isFinite(startTime)) {
        return;
      }

      const normalizedStartTime = startTime as number;

      setClaudeStatus((prev) => ({
        text: prev?.text || fallbackText,
        tokens: prev?.tokens || 0,
        can_interrupt:
          prev?.can_interrupt !== undefined ? prev.can_interrupt : true,
        startTime: normalizedStartTime,
      }));
    };

    const clearLoadingIndicators = () => {
      setIsLoading(false);
      setCanAbortSession(false);
      setClaudeStatus(null);
      setStatusTextOverride(null);
    };

    const flushPendingStream = () => {
      if (streamTimerRef.current) {
        clearTimeout(streamTimerRef.current);
        streamTimerRef.current = null;
      }
      streamBufferRef.current = "";
    };

    const markSessionsAsCompleted = (
      ...sessionIds: Array<string | null | undefined>
    ) => {
      const normalizedSessionIds = sessionIds.filter(
        (id): id is string => typeof id === "string" && id.length > 0,
      );
      normalizedSessionIds.forEach((sessionId) => {
        clearSessionTimerStart(sessionId);
        notifySessionCompleted(
          sessionId,
          latestMessageProvider,
          latestMessageProjectName,
        );
      });
      finalizeSessionLifecycle(sessionIds, {
        projectName: selectedProject?.name,
        onSessionInactive,
        onSessionNotProcessing,
        onSessionStatusResolved,
      });
    };

    if (!shouldBypassSessionFilter) {
      if (!activeViewSessionId) {
        if (lifecycleMessageTypes.has(String(normalizedLatestMessage.type))) {
          getLifecycleSessionIds().forEach((sessionId) => {
            handleBackgroundLifecycle(sessionId);
          });
        }
        if (!isUnscopedError) {
          logFilterDecision("dropped:no-active-view-session");
          return;
        }
      }

      if (!routedMessageSessionId && !isUnscopedError) {
        logFilterDecision("dropped:missing-session-id");
        return;
      }

      if (routedMessageSessionId && activeViewSessionId && routedMessageSessionId !== activeViewSessionId) {
        if (lifecycleMessageTypes.has(String(normalizedLatestMessage.type))) {
          getLifecycleSessionIds().forEach((sessionId) => {
            handleBackgroundLifecycle(sessionId);
          });
        }
        logFilterDecision("dropped:session-id-mismatch", {
          expectedSessionId: activeViewSessionId,
          actualSessionId: routedMessageSessionId,
        });
        return;
      }

      if (latestMessageProvider !== activeViewProvider) {
        if (lifecycleMessageTypes.has(String(normalizedLatestMessage.type))) {
          getLifecycleSessionIds().forEach((sessionId) => {
            handleBackgroundLifecycle(sessionId);
          });
        }
        logFilterDecision("dropped:provider-mismatch", {
          expectedProvider: activeViewProvider,
          actualProvider: latestMessageProvider,
        });
        return;
      }

      if (
        activeViewProjectName &&
        latestMessageProjectName &&
        activeViewProjectName !== latestMessageProjectName
      ) {
        if (lifecycleMessageTypes.has(String(normalizedLatestMessage.type))) {
          getLifecycleSessionIds().forEach((sessionId) => {
            handleBackgroundLifecycle(sessionId);
          });
        }
        logFilterDecision("dropped:project-mismatch", {
          expectedProjectName: activeViewProjectName,
          actualProjectName: latestMessageProjectName,
        });
        return;
      }
    }

    switch (normalizedLatestMessage.type) {
      case "session-accepted":
      case "chat-turn-accepted": {
        const acceptedSessionId =
          routedMessageSessionId ||
          routedMessageProvisionalSessionId ||
          pendingViewSessionRef.current?.sessionId ||
          currentSessionId ||
          selectedSession?.id ||
          null;
        const acceptedAt = Number.isFinite(normalizedLatestMessage.acceptedAt)
          ? (normalizedLatestMessage.acceptedAt as number)
          : Date.now();
        const acceptedProvider = resolveProvider(
          typeof normalizedLatestMessage.provider === "string"
            ? normalizedLatestMessage.provider
            : provider,
        );
        const acceptedProjectName = resolveProjectName(
          typeof normalizedLatestMessage.projectName === "string"
            ? normalizedLatestMessage.projectName
            : selectedProject?.name || null,
        );
        const isCurrentSession =
          !acceptedSessionId ||
          isMessageInActiveScope(
            acceptedSessionId,
            acceptedProvider,
            acceptedProjectName,
          );

        if (acceptedSessionId) {
          persistStartTime(
            acceptedAt,
            acceptedSessionId,
            currentSessionId,
            selectedSession?.id,
          );
          notifySessionProcessing(
            acceptedSessionId,
            acceptedProvider,
            acceptedProjectName,
          );
        }

        if (isCurrentSession) {
          setIsLoading(true);
          setCanAbortSession(true);
          syncClaudeStatusStartTime(acceptedAt, "Processing");
        }
        break;
      }

      case "session-busy": {
        const busySessionId =
          routedMessageSessionId ||
          pendingViewSessionRef.current?.sessionId ||
          currentSessionId ||
          selectedSession?.id ||
          null;
        const busyAt = Number.isFinite(normalizedLatestMessage.reportedAt)
          ? (normalizedLatestMessage.reportedAt as number)
          : Date.now();
        const busyProvider = resolveProvider(
          typeof normalizedLatestMessage.provider === "string"
            ? normalizedLatestMessage.provider
            : provider,
        );
        const busyProjectName = resolveProjectName(
          typeof normalizedLatestMessage.projectName === "string"
            ? normalizedLatestMessage.projectName
            : selectedProject?.name || null,
        );
        const isCurrentSession =
          !busySessionId ||
          isMessageInActiveScope(busySessionId, busyProvider, busyProjectName);

        if (busySessionId) {
          persistStartTime(
            busyAt,
            busySessionId,
            currentSessionId,
            selectedSession?.id,
          );
          notifySessionProcessing(busySessionId, busyProvider, busyProjectName);
        }

        if (busyProvider === "codex") {
          onCodexSessionBusy?.(busySessionId);
        }

        if (isCurrentSession) {
          const busyMessage = String(
            normalizedLatestMessage.message ||
              "Session is busy. Waiting for the current turn to finish.",
          );
          setIsLoading(true);
          setCanAbortSession(true);
          setStatusTextOverride(busyMessage);
          setChatMessages((previous) => {
            const lastMessage = previous[previous.length - 1];
            if (
              lastMessage &&
              lastMessage.type === "assistant" &&
              String(lastMessage.content || "") === busyMessage
            ) {
              return previous;
            }
            return [
              ...previous,
              {
                type: "assistant",
                content: busyMessage,
                timestamp: new Date(),
              },
            ];
          });
        }
        break;
      }

      case "chat-sidebar-remove":
        break;

      case "chat-session-upsert":
      case "session-state-changed": {
        const stateSessionId =
          typeof routedMessageSessionId === "string"
            ? routedMessageSessionId
            : null;
        if (!stateSessionId) {
          break;
        }

        const state =
          normalizedLatestMessage.type === "chat-session-upsert"
            ? (normalizedLatestMessage.processing ? "running" : "idle")
            : String(normalizedLatestMessage.state || "").toLowerCase();
        const stateProvider = resolveProvider(
          typeof normalizedLatestMessage.provider === "string"
            ? normalizedLatestMessage.provider
            : provider,
        );
        const stateProjectName = resolveProjectName(
          typeof normalizedLatestMessage.projectName === "string"
            ? normalizedLatestMessage.projectName
            : selectedProject?.name || null,
        );
        const isCurrentSession =
          isMessageInActiveScope(
            stateSessionId,
            stateProvider,
            stateProjectName,
          );
        const isProcessingState =
          state === "running" ||
          state === "queued" ||
          state === "in_progress" ||
          state === "waiting_user";
        const isTerminalState =
          state === "completed" ||
          state === "failed" ||
          state === "aborted" ||
          state === "error" ||
          state === "idle";

        if (isProcessingState) {
          notifySessionProcessing(stateSessionId, stateProvider, stateProjectName);
          if (isCurrentSession) {
            setIsLoading(true);
            setCanAbortSession(true);
          }
          break;
        }

        if (isTerminalState) {
          clearSessionTimerStart(stateSessionId);
          notifySessionCompleted(stateSessionId, stateProvider, stateProjectName);
          if (isCurrentSession) {
            clearLoadingIndicators();
          }
        }
        break;
      }

      case "chat-session-created":
      case "session-created":
        if (normalizedLatestMessage.sessionId) {
          const createdSessionProvider =
            resolveProvider(
              typeof normalizedLatestMessage.provider === "string"
                ? normalizedLatestMessage.provider
                : provider,
            );
          const explicitProjectName = resolveProjectName(
            typeof normalizedLatestMessage.projectName === "string"
              ? normalizedLatestMessage.projectName
              : null,
          );
          const createdProjectName =
            explicitProjectName
            || (pendingViewSessionRef.current ? selectedProject?.name || null : null);
          const pendingStartTime = pendingViewSessionRef.current?.startedAt;
          const pendingTemporarySessionId = pendingViewSessionRef.current
            ?.sessionId?.startsWith("new-session-")
            ? pendingViewSessionRef.current.sessionId
            : null;
          const temporarySessionId =
            routedMessageProvisionalSessionId ||
            (currentSessionId?.startsWith("new-session-")
              ? currentSessionId
              : pendingTemporarySessionId);
          const shouldAdoptCreatedSession =
            !currentSessionId ||
            (temporarySessionId
              ? temporarySessionId === currentSessionId
              : currentSessionId.startsWith("new-session-"));
          if (temporarySessionId) {
            moveSessionTimerStart(temporarySessionId, normalizedLatestMessage.sessionId);
            if (createdSessionProvider === "codex") {
              onCodexSessionIdResolved?.(
                temporarySessionId,
                normalizedLatestMessage.sessionId,
              );
            }
          }
          persistStartTime(
            typeof normalizedLatestMessage.startTime === "number"
              ? normalizedLatestMessage.startTime
              : pendingStartTime,
            normalizedLatestMessage.sessionId,
          );
          if (createdProjectName && normalizedLatestMessage.mode) {
            safeLocalStorage.setItem(
              `session_mode_${createdProjectName}_${normalizedLatestMessage.sessionId}`,
              String(normalizedLatestMessage.mode),
            );
          }
          persistScopedPendingSessionId(
            createdProjectName,
            createdSessionProvider,
            normalizedLatestMessage.sessionId,
          );
          if (
            pendingViewSessionRef.current &&
            (!pendingViewSessionRef.current.sessionId ||
              pendingViewSessionRef.current.sessionId.startsWith(
                "new-session-",
              ))
          ) {
            pendingViewSessionRef.current.sessionId = normalizedLatestMessage.sessionId;
          }
          if (shouldAdoptCreatedSession) {
            setIsSystemSessionChange(true);
            onReplaceTemporarySession?.(
              normalizedLatestMessage.sessionId,
              createdSessionProvider,
              createdProjectName,
              temporarySessionId,
            );
            if (createdProjectName || pendingViewSessionRef.current) {
              onNavigateToSession?.(normalizedLatestMessage.sessionId, createdSessionProvider, createdProjectName || undefined, { source: 'system' });
            }
          }
          setPendingPermissionRequests((previous) =>
            previous.map((request) =>
              request.sessionId
                ? request
                : { ...request, sessionId: normalizedLatestMessage.sessionId },
            ),
          );
        }
        break;

      case "chat-turn-delta": {
        const itemId = normalizedLatestMessage.messageId;
        const content = decodeHtmlEntities(
          String(normalizedLatestMessage.textDelta || ""),
        );
        if (!content.trim()) {
          break;
        }

        const isSystemPrompt =
          normalizedLatestMessage.partKind === "thinking" ||
          /^#\s+(AGENTS|SKILL|INSTRUCTIONS)/m.test(content) ||
          content.includes("<INSTRUCTIONS>") ||
          content.includes("</INSTRUCTIONS>") ||
          /^#+\s+.*instructions\s+for\s+\//im.test(content) ||
          (content.includes("Base directory for this skill:") &&
            content.length > 500) ||
          (content.length > 2000 &&
            /^\d+\)\s/m.test(content) &&
            /\bskill\b/i.test(content)) ||
          (content.match(/SKILL\.md\)/g) || []).length >= 3 ||
          content.includes("### How to use skills") ||
          content.includes("## How to use skills") ||
          (content.includes("Trigger rules:") &&
            content.includes("skill") &&
            content.length > 500);

        setIsLoading(true);
        if (isSystemPrompt) {
          setChatMessages((previous) => {
            if (itemId) {
              const existingIdx = previous.findIndex(
                (message) =>
                  message.codexItemId === itemId &&
                  message.isSkillContent,
              );
              if (existingIdx >= 0) {
                const updated = [...previous];
                const existingContent = String(
                  updated[existingIdx].content || "",
                );
                updated[existingIdx] = {
                  ...updated[existingIdx],
                  content: `${existingContent}${content}`,
                  timestamp: new Date(),
                };
                return updated;
              }
            }
            return [
              ...previous,
              {
                type: "user",
                content,
                timestamp: new Date(),
                isSkillContent: true,
                codexItemId: itemId,
              },
            ];
          });
        } else {
          setChatMessages((previous) => {
            if (itemId) {
              const existingIdx = previous.findIndex(
                (message) =>
                  message.codexItemId === itemId &&
                  message.type === "assistant" &&
                  !message.isToolUse,
              );
              if (existingIdx >= 0) {
                const updated = [...previous];
                const existingContent = String(
                  updated[existingIdx].content || "",
                );
                updated[existingIdx] = {
                  ...updated[existingIdx],
                  content: `${existingContent}${content}`,
                  timestamp: new Date(),
                };
                return updated;
              }
            }
            return [
              ...previous,
              {
                type: "assistant",
                content,
                timestamp: new Date(),
                codexItemId: itemId,
              },
            ];
          });
        }
        break;
      }

      case "chat-turn-item": {
        const codexData: Record<string, any> = {
          itemType: normalizedLatestMessage.itemType,
          itemId: normalizedLatestMessage.itemId,
          lifecycle: normalizedLatestMessage.lifecycle,
          command:
            typeof normalizedLatestMessage.input === "string"
              ? normalizedLatestMessage.input
              : normalizedLatestMessage.input &&
                  typeof normalizedLatestMessage.input === "object" &&
                  typeof (normalizedLatestMessage.input as Record<string, unknown>).command ===
                    "string"
                ? ((normalizedLatestMessage.input as Record<string, unknown>).command as string)
                : "",
          output:
            typeof normalizedLatestMessage.output === "string"
              ? normalizedLatestMessage.output
              : normalizedLatestMessage.output != null
                ? JSON.stringify(normalizedLatestMessage.output)
                : "",
          exitCode:
            normalizedLatestMessage.output &&
            typeof normalizedLatestMessage.output === "object" &&
            Number.isFinite(
              (normalizedLatestMessage.output as Record<string, unknown>).exitCode,
            )
              ? ((normalizedLatestMessage.output as Record<string, unknown>).exitCode as number)
              : undefined,
          status:
            typeof normalizedLatestMessage.status === "string"
              ? normalizedLatestMessage.status
              : undefined,
          message:
            typeof normalizedLatestMessage.output === "string"
              ? { content: normalizedLatestMessage.output }
              : normalizedLatestMessage.output &&
                  typeof normalizedLatestMessage.output === "object" &&
                  typeof (normalizedLatestMessage.output as Record<string, unknown>).content ===
                    "string"
                ? {
                    content: String(
                      (normalizedLatestMessage.output as Record<string, unknown>).content,
                    ),
                  }
                : undefined,
          changes:
            Array.isArray(normalizedLatestMessage.input)
              ? normalizedLatestMessage.input
              : normalizedLatestMessage.input &&
                  typeof normalizedLatestMessage.input === "object" &&
                  Array.isArray(
                    (normalizedLatestMessage.input as Record<string, unknown>).changes,
                  )
                ? ((normalizedLatestMessage.input as Record<string, unknown>).changes as Array<{
                    kind: string;
                    path: string;
                  }>)
                : undefined,
          server:
            normalizedLatestMessage.input &&
            typeof normalizedLatestMessage.input === "object" &&
            typeof (normalizedLatestMessage.input as Record<string, unknown>).server === "string"
              ? String((normalizedLatestMessage.input as Record<string, unknown>).server)
              : undefined,
          tool:
            normalizedLatestMessage.input &&
            typeof normalizedLatestMessage.input === "object" &&
            typeof (normalizedLatestMessage.input as Record<string, unknown>).tool === "string"
              ? String((normalizedLatestMessage.input as Record<string, unknown>).tool)
              : undefined,
          arguments:
            normalizedLatestMessage.input &&
            typeof normalizedLatestMessage.input === "object" &&
            (normalizedLatestMessage.input as Record<string, unknown>).arguments &&
            typeof (normalizedLatestMessage.input as Record<string, unknown>).arguments === "object"
              ? (normalizedLatestMessage.input as Record<string, unknown>).arguments
              : undefined,
          result:
            normalizedLatestMessage.output &&
            typeof normalizedLatestMessage.output === "object" &&
            (normalizedLatestMessage.output as Record<string, unknown>).result
              ? (normalizedLatestMessage.output as Record<string, unknown>).result
              : undefined,
          error:
            normalizedLatestMessage.isError
              ? {
                  message:
                    typeof normalizedLatestMessage.output === "string"
                      ? normalizedLatestMessage.output
                      : normalizedLatestMessage.status || "Tool error",
                }
              : undefined,
          query:
            typeof normalizedLatestMessage.input === "string"
              ? normalizedLatestMessage.input
              : normalizedLatestMessage.input &&
                  typeof normalizedLatestMessage.input === "object" &&
                  typeof (normalizedLatestMessage.input as Record<string, unknown>).query === "string"
                ? String((normalizedLatestMessage.input as Record<string, unknown>).query)
                : undefined,
        };
        const itemId = codexData.itemId;
        const lifecycle = codexData.lifecycle; // 'started' | 'completed' | 'other'

        setIsLoading(true);
        switch (codexData.itemType) {
            case "agent_message":
              if (codexData.message?.content?.trim()) {
                const content = decodeHtmlEntities(codexData.message.content);

                // Server marks system prompts; also detect on frontend as fallback
                const isSystemPrompt =
                  codexData.isSystemPrompt ||
                  /^#\s+(AGENTS|SKILL|INSTRUCTIONS)/m.test(content) ||
                  content.includes("<INSTRUCTIONS>") ||
                  content.includes("</INSTRUCTIONS>") ||
                  /^#+\s+.*instructions\s+for\s+\//im.test(content) ||
                  (content.includes("Base directory for this skill:") &&
                    content.length > 500) ||
                  (content.length > 2000 &&
                    /^\d+\)\s/m.test(content) &&
                    /\bskill\b/i.test(content)) ||
                  (content.match(/SKILL\.md\)/g) || []).length >= 3 ||
                  content.includes("### How to use skills") ||
                  content.includes("## How to use skills") ||
                  (content.includes("Trigger rules:") &&
                    content.includes("skill") &&
                    content.length > 500);

                if (isSystemPrompt) {
                  // Show as collapsed skill content.
                  setChatMessages((previous) => {
                    if (itemId) {
                      const existingIdx = previous.findIndex(
                        (message) =>
                          message.codexItemId === itemId &&
                          message.isSkillContent,
                      );
                      if (existingIdx >= 0) {
                        const updated = [...previous];
                        const existingContent = String(
                          updated[existingIdx].content || "",
                        );
                        updated[existingIdx] = {
                          ...updated[existingIdx],
                          content: `${existingContent}${content}`,
                          timestamp: new Date(),
                        };
                        return updated;
                      }
                    }

                    return [
                      ...previous,
                      {
                        type: "user",
                        content,
                        timestamp: new Date(),
                        isSkillContent: true,
                        codexItemId: itemId,
                      },
                    ];
                  });
                } else {
                  setChatMessages((previous) => {
                    if (itemId) {
                      const existingIdx = previous.findIndex(
                        (message) =>
                          message.codexItemId === itemId &&
                          message.type === "assistant" &&
                          !message.isToolUse,
                      );
                      if (existingIdx >= 0) {
                        const updated = [...previous];
                        const existingContent = String(
                          updated[existingIdx].content || "",
                        );
                        updated[existingIdx] = {
                          ...updated[existingIdx],
                          content: `${existingContent}${content}`,
                          timestamp: new Date(),
                        };
                        return updated;
                      }
                    }

                    return [
                      ...previous,
                      {
                        type: "assistant",
                        content,
                        timestamp: new Date(),
                        codexItemId: itemId,
                      },
                    ];
                  });
                }
              }
              break;

            case "reasoning":
              // Codex reasoning items are very brief status notes (e.g. "Planning API path inspection")
              // They add noise without value - skip them entirely for Codex sessions
              break;

            case "command_execution":
              if (lifecycle !== "completed") {
                setStatusTextOverride(i18n.t("chat:status.runningCode"));
              } else {
                setStatusTextOverride(null);
              }
              if (codexData.command) {
                const exitCode = codexData.exitCode;
                const output = codexData.output;
                // Wrap command in object format expected by Bash ToolRenderer
                const bashToolInput = { command: codexData.command };

                if (lifecycle === "completed" && itemId) {
                  // Update existing tool message if it was added on 'started'
                  setChatMessages((previous) => {
                    const existingIdx = previous.findIndex(
                      (m) => m.codexItemId === itemId && m.isToolUse,
                    );
                    if (existingIdx >= 0) {
                      const updated = [...previous];
                      updated[existingIdx] = {
                        ...updated[existingIdx],
                        toolResult:
                          output != null
                            ? {
                                content: output,
                                isError: exitCode != null && exitCode !== 0,
                              }
                            : null,
                        exitCode,
                      };
                      return updated;
                    }
                    // Not found, add new
                    return [
                      ...previous,
                      {
                        type: "assistant",
                        content: "",
                        timestamp: new Date(),
                        isToolUse: true,
                        toolName: "Bash",
                        toolInput: bashToolInput,
                        toolResult:
                          output != null
                            ? {
                                content: output,
                                isError: exitCode != null && exitCode !== 0,
                              }
                            : null,
                        exitCode,
                        codexItemId: itemId,
                      },
                    ];
                  });
                } else {
                  // 'started' or no lifecycle - add new tool message
                  setChatMessages((previous) => [
                    ...previous,
                    {
                      type: "assistant",
                      content: "",
                      timestamp: new Date(),
                      isToolUse: true,
                      toolName: "Bash",
                      toolInput: bashToolInput,
                      toolResult:
                        output != null
                          ? {
                              content: output,
                              isError: exitCode != null && exitCode !== 0,
                            }
                          : null,
                      exitCode,
                      codexItemId: itemId,
                    },
                  ]);
                }
              }
              break;

            case "file_change":
              if (codexData.changes?.length > 0) {
                const changesList = codexData.changes
                  .map(
                    (change: { kind: string; path: string }) =>
                      `${change.kind}: ${change.path}`,
                  )
                  .join("\n");

                if (lifecycle === "completed" && itemId) {
                  setChatMessages((previous) => {
                    const existingIdx = previous.findIndex(
                      (m) => m.codexItemId === itemId && m.isToolUse,
                    );
                    if (existingIdx >= 0) {
                      const updated = [...previous];
                      updated[existingIdx] = {
                        ...updated[existingIdx],
                        toolInput: changesList,
                        toolResult: {
                          content: `Status: ${codexData.status}`,
                          isError: false,
                        },
                      };
                      return updated;
                    }
                    return [
                      ...previous,
                      {
                        type: "assistant",
                        content: "",
                        timestamp: new Date(),
                        isToolUse: true,
                        toolName: "FileChanges",
                        toolInput: changesList,
                        toolResult: {
                          content: `Status: ${codexData.status}`,
                          isError: false,
                        },
                        codexItemId: itemId,
                      },
                    ];
                  });
                } else {
                  setChatMessages((previous) => [
                    ...previous,
                    {
                      type: "assistant",
                      content: "",
                      timestamp: new Date(),
                      isToolUse: true,
                      toolName: "FileChanges",
                      toolInput: changesList,
                      toolResult: codexData.status
                        ? {
                            content: `Status: ${codexData.status}`,
                            isError: false,
                          }
                        : null,
                      codexItemId: itemId,
                    },
                  ]);
                }
              }
              break;

            case "mcp_tool_call": {
              const toolResult = codexData.result
                ? {
                    content: JSON.stringify(codexData.result, null, 2),
                    isError: false,
                  }
                : codexData.error?.message
                  ? { content: codexData.error.message, isError: true }
                  : null;

              if (lifecycle === "completed" && itemId) {
                setChatMessages((previous) => {
                  const existingIdx = previous.findIndex(
                    (m) => m.codexItemId === itemId && m.isToolUse,
                  );
                  if (existingIdx >= 0) {
                    const updated = [...previous];
                    updated[existingIdx] = {
                      ...updated[existingIdx],
                      toolResult,
                    };
                    return updated;
                  }
                  return [
                    ...previous,
                    {
                      type: "assistant",
                      content: "",
                      timestamp: new Date(),
                      isToolUse: true,
                      toolName: `${codexData.server}:${codexData.tool}`,
                      toolInput: JSON.stringify(codexData.arguments, null, 2),
                      toolResult,
                      codexItemId: itemId,
                    },
                  ];
                });
              } else {
                setChatMessages((previous) => [
                  ...previous,
                  {
                    type: "assistant",
                    content: "",
                    timestamp: new Date(),
                    isToolUse: true,
                    toolName: `${codexData.server}:${codexData.tool}`,
                    toolInput: JSON.stringify(codexData.arguments, null, 2),
                    toolResult,
                    codexItemId: itemId,
                  },
                ]);
              }
              break;
            }

            case "web_search": {
              const query = codexData.query || "Searching...";
              if (lifecycle === "completed" && itemId) {
                // Update existing or add new
                setChatMessages((previous) => {
                  const existingIdx = previous.findIndex(
                    (m) => m.codexItemId === itemId && m.isToolUse,
                  );
                  if (existingIdx >= 0) {
                    // Already shown from 'started', no update needed for web_search
                    return previous;
                  }
                  return [
                    ...previous,
                    {
                      type: "assistant",
                      content: "",
                      timestamp: new Date(),
                      isToolUse: true,
                      toolName: "WebSearch",
                      toolInput: { command: query },
                      toolResult: null,
                      codexItemId: itemId,
                    },
                  ];
                });
              } else {
                setChatMessages((previous) => [
                  ...previous,
                  {
                    type: "assistant",
                    content: "",
                    timestamp: new Date(),
                    isToolUse: true,
                    toolName: "WebSearch",
                    toolInput: { command: query },
                    toolResult: null,
                    codexItemId: itemId,
                  },
                ]);
              }
              break;
            }

            case "error":
              if (codexData.message?.content) {
                setChatMessages((previous) => [
                  ...previous,
                  {
                    type: "error",
                    content: codexData.message.content,
                    timestamp: new Date(),
                  },
                ]);
              }
              break;

            default:
              console.log(
                "[Codex] Unhandled item type:",
                codexData.itemType,
                codexData,
              );
        }
        break;
      }

      case "chat-turn-complete": {
        const codexPendingSessionId =
          readScopedPendingSessionId(latestMessageProjectName, "codex");
        const codexActualSessionId =
          normalizedLatestMessage.actualSessionId ||
          codexPendingSessionId ||
          routedMessageSessionId;
        const codexCompletedSessionId =
          routedMessageSessionId || currentSessionId || codexPendingSessionId;
        clearLoadingIndicators();
        markSessionsAsCompleted(
          codexCompletedSessionId,
          codexActualSessionId,
          currentSessionId,
          selectedSession?.id,
          codexPendingSessionId,
        );

        const shouldSyncToActualSessionId =
          Boolean(codexActualSessionId) &&
          codexActualSessionId !== currentSessionId &&
          ((currentSessionId && currentSessionId.startsWith("new-session-")) ||
            Boolean(codexPendingSessionId));

        if (shouldSyncToActualSessionId) {
          setCurrentSessionId(codexActualSessionId || null);
          setIsSystemSessionChange(true);
          if (codexActualSessionId) {
            onNavigateToSession?.(codexActualSessionId, 'codex', selectedProject?.name, { source: 'system' });
          }
        }

        if (codexPendingSessionId) {
          clearScopedPendingSessionId(latestMessageProjectName, "codex");
        }

        clearScopedMessageCache(
          codexCompletedSessionId || codexActualSessionId,
          "codex",
          latestMessageProjectName,
        );
        break;
      }

      case "chat-turn-error":
        if (isLegacyTaskMasterInstallError(normalizedLatestMessage.error)) break;
        flushPendingStream();
        clearLoadingIndicators();
        clearScopedPendingSessionId(latestMessageProjectName, "codex");
        markSessionsAsCompleted(
          routedMessageSessionId,
          currentSessionId,
          selectedSession?.id,
        );
        setPendingPermissionRequests([]);
        setChatMessages((previous) => [
          ...previous,
          {
            type: "error",
            content: normalizedLatestMessage.error || "An error occurred with Codex",
            timestamp: new Date(),
            errorType: normalizedLatestMessage.errorType,
            isRetryable: normalizedLatestMessage.isRetryable === true,
          },
        ]);
        break;

      case "token-budget":
        if (normalizedLatestMessage.data) {
          setTokenBudget(normalizedLatestMessage.data);
        }
        break;

      case "session-aborted": {
        const abortedProvider = resolveProvider(
          typeof normalizedLatestMessage.provider === "string"
            ? normalizedLatestMessage.provider
            : provider,
        );
        const abortedProjectName = resolveProjectName(
          typeof normalizedLatestMessage.projectName === "string"
            ? normalizedLatestMessage.projectName
            : selectedProject?.name || null,
        );
        const pendingSessionId = readScopedPendingSessionId(
          abortedProjectName,
          abortedProvider,
        );
        const abortedSessionId = routedMessageSessionId || currentSessionId;
        if (normalizedLatestMessage.success !== false) {
          clearLoadingIndicators();
          markSessionsAsCompleted(
            abortedSessionId,
            currentSessionId,
            selectedSession?.id,
            pendingSessionId,
          );
          if (
            pendingSessionId &&
            (!abortedSessionId || pendingSessionId === abortedSessionId)
          )
            clearScopedPendingSessionId(abortedProjectName, abortedProvider);
          setPendingPermissionRequests([]);
          setChatMessages((previous) => [
            ...previous,
            {
              type: "assistant",
              content: "Session interrupted by user.",
              timestamp: new Date(),
            },
          ]);
        } else {
          clearLoadingIndicators();
          setPendingPermissionRequests([]);
          setChatMessages((previous) => [
            ...previous,
            {
              type: "error",
              content: "Session has already finished.",
              timestamp: new Date(),
            },
          ]);
        }
        break;
      }

      case "session-status": {
        const statusSessionId = routedMessageSessionId;
        if (!statusSessionId) {
          break;
        }

        const statusProvider = resolveProvider(
          typeof normalizedLatestMessage.provider === "string"
            ? normalizedLatestMessage.provider
            : provider,
        );
        const statusProjectName = resolveProjectName(
          typeof normalizedLatestMessage.projectName === "string"
            ? normalizedLatestMessage.projectName
            : selectedProject?.name || null,
        );
        const isCurrentSession = isMessageInActiveScope(
          statusSessionId,
          statusProvider,
          statusProjectName,
        );
        if (normalizedLatestMessage.isProcessing) {
          persistStartTime(
            normalizedLatestMessage.startTime,
            statusSessionId,
            currentSessionId,
            selectedSession?.id,
          );
          notifySessionProcessing(
            statusSessionId,
            statusProvider,
            statusProjectName,
          );

          if (!isCurrentSession) {
            break;
          }

          setIsLoading(true);
          setCanAbortSession(true);
          // If we have a startTime from the backend, sync our status
          if (Number.isFinite(normalizedLatestMessage.startTime)) {
            syncClaudeStatusStartTime(
              normalizedLatestMessage.startTime,
              RESUMING_STATUS_TEXT,
            );
          }
        } else if (normalizedLatestMessage.isProcessing === false) {
          clearSessionTimerStart(statusSessionId);
          notifySessionCompleted(
            statusSessionId,
            statusProvider,
            statusProjectName,
          );

          if (!isCurrentSession) {
            break;
          }

          clearLoadingIndicators();
        }
        break;
      }

      default:
        break;
    }
  }, [
    latestMessage,
    provider,
    selectedProject,
    selectedSession,
    currentSessionId,
    setCurrentSessionId,
    setChatMessages,
    setIsLoading,
    setCanAbortSession,
    setClaudeStatus,
    setStatusTextOverride,
    setTokenBudget,
    setIsSystemSessionChange,
    setPendingPermissionRequests,
    onSessionInactive,
    onSessionProcessing,
    onSessionNotProcessing,
    onSessionStatusResolved,
    onCodexTurnStarted,
    onCodexTurnSettled,
    onCodexSessionBusy,
    onCodexSessionIdResolved,
    onReplaceTemporarySession,
    onNavigateToSession,
    sendMessage,
  ]);
}



