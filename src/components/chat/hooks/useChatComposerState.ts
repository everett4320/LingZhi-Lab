import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ChangeEvent,
  ClipboardEvent,
  Dispatch,
  FormEvent,
  KeyboardEvent,
  MouseEvent,
  SetStateAction,
  TouchEvent,
} from "react";
import { useDropzone } from "react-dropzone";
import type { FileRejection } from "react-dropzone";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { authenticatedFetch } from "../../../utils/api";
import { isTelemetryEnabled } from "../../../utils/telemetry";

import { thinkingModes } from "../constants/thinkingModes";
import type { CodexReasoningEffortId } from "../constants/codexReasoningEfforts";
import { getSupportedCodexReasoningEfforts } from "../constants/codexReasoningSupport";

import { grantToolPermission } from "../utils/chatPermissions";
import { applyEditedMessageToHistory, createChatMessageId } from '../utils/chatMessages';
import {
  buildDraftInputStorageKey,
  clearScopedPendingSessionId,
  clearSessionTimerStart,
  persistScopedPendingSessionId,
  persistSessionTimerStart,
  readScopedPendingSessionId,
  safeLocalStorage,
} from "../utils/chatStorage";
import { hasUnsavedComposerDraft, normalizeProgrammaticDraft, resolveLineHeightPx } from '../utils/composerUtils';
import {
  consumeWorkspaceQaDraft,
  WORKSPACE_QA_DRAFT_EVENT,
} from "../../../utils/workspaceQa";
import {
  consumeReferenceChatDraft,
  REFERENCE_CHAT_DRAFT_EVENT,
} from "../../../utils/referenceChatDraft";
import type {
  AttachedPrompt,
  ChatAttachment,
  ChatImage,
  ChatMessage,
  CodexInputMessage,
  PendingPermissionRequest,
  PermissionMode,
  TokenBudget,
} from "../types/types";
import { useFileMentions } from "./useFileMentions";
import { type SlashCommand, useSlashCommands } from "./useSlashCommands";
import type {
  Project,
  ProjectSession,
  SessionProvider,
} from "../../../types/app";
import { escapeRegExp } from "../utils/chatFormatting";
import type { SessionMode } from "../../../types/app";
import { normalizeProvider } from "../../../utils/providerPolicy";
import {
  buildSessionScopeKey,
  parseSessionScopeKey,
  scopeKeyMatchesSessionId,
} from "../../../utils/sessionScope";
import {
  createCodexInputMessage,
  createEmptyCodexInputState,
  getSessionInputState,
  upsertSessionInputState,
  reduceCodexInputSubmit,
  reduceCodexSteerCommitted,
  reduceCodexSteerRejected,
  reduceCodexTurnStarted,
  reduceCodexTurnCompleted,
  reduceCodexTurnAborted,
  reconcileSessionInputStateId,
  updateSessionBinding,
  popLastQueuedMessage,
  type SessionInputStateMap,
  type CodexInputDispatchResolution,
} from "../utils/codexQueue";
import {
  OPTIMISTIC_SESSION_CREATED_EVENT,
  type OptimisticSessionCreatedDetail,
} from "../../../constants/sessionEvents";
import type { BtwOverlayState } from "../view/subcomponents/BtwOverlay";

type PendingViewSession = {
  sessionId: string | null;
  startedAt: number;
};

function resolveDispatchMessage(
  resolution: CodexInputDispatchResolution,
): CodexInputMessage | null {
  if (resolution.action === 'dispatch-start') {
    return resolution.message;
  }
  if (resolution.action === 'dispatch-merge-start') {
    return resolution.merged;
  }
  return null;
}

interface UseChatComposerStateArgs {
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  provider: SessionProvider;
  permissionMode: PermissionMode | string;
  cyclePermissionMode: () => void;
  codexModel: string;
  isLoading: boolean;
  canAbortSession: boolean;
  tokenBudget: TokenBudget | null;
  sendMessage: (message: unknown) => void;
  sendByCtrlEnter?: boolean;
  onSessionActive?: (
    sessionId?: string | null,
    provider?: SessionProvider | null,
    projectName?: string | null,
  ) => void;
  onSessionProcessing?: (
    sessionId?: string | null,
    provider?: SessionProvider | null,
    projectName?: string | null,
  ) => void;
  onInputFocusChange?: (focused: boolean) => void;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  onShowSettings?: () => void;
  processingSessions?: Set<string>;
  pendingViewSessionRef: { current: PendingViewSession | null };
  scrollToBottom: () => void;
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setSessionMessages?: Dispatch<SetStateAction<any[]>>;
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
  setIsUserScrolledUp: (isScrolledUp: boolean) => void;
  setPendingPermissionRequests: Dispatch<
    SetStateAction<PendingPermissionRequest[]>
  >;
  newSessionMode?: SessionMode;
  /** Current chat messages for /btw context. */
  getChatMessagesForBtw?: () => ChatMessage[];
}

interface MentionableFile {
  name: string;
  path: string;
}

interface CommandExecutionResult {
  type: "builtin" | "custom";
  action?: string;
  data?: any;
  content?: string;
  hasBashCommands?: boolean;
  hasFileIncludes?: boolean;
}

interface UploadedProjectFile {
  name?: string;
  path?: string;
  size?: number;
}

interface ProgrammaticMessageDraft {
  content?: string;
  attachedPrompt?: AttachedPrompt | null;
  editingMessageId?: string | null;
}

const createFakeSubmitEvent = () => {
  return {
    preventDefault: () => undefined,
  } as unknown as FormEvent<HTMLFormElement>;
};

const PROGRAMMATIC_SUBMIT_MAX_RETRIES = 12;
const PROGRAMMATIC_SUBMIT_RETRY_DELAY_MS = 50;
const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_SIZE_BYTES = 50 * 1024 * 1024;
const CODEX_ATTACHMENT_DIR = ".lingzhi-lab/chat-attachments";
const CLOSED_BTW_OVERLAY: BtwOverlayState = {
  open: false,
  question: "",
  answer: "",
  loading: false,
  error: null,
};

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".svg",
  ".heic",
  ".heif",
]);

const PDF_EXTENSION = ".pdf";

function getAttachmentKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function getFileExtension(file: File) {
  const lowerName = file.name.toLowerCase();
  const lastDot = lowerName.lastIndexOf(".");
  return lastDot >= 0 ? lowerName.slice(lastDot) : "";
}

function isImageAttachment(file: File) {
  return (
    file.type.startsWith("image/") ||
    IMAGE_EXTENSIONS.has(getFileExtension(file))
  );
}

function isPdfAttachment(file: File) {
  return (
    file.type === "application/pdf" || getFileExtension(file) === PDF_EXTENSION
  );
}

function getAttachmentKind(file: File) {
  if (isImageAttachment(file)) {
    return "image";
  }
  if (isPdfAttachment(file)) {
    return "pdf";
  }
  return "file";
}

function formatRejectedFileMessage(rejection: FileRejection) {
  const attachmentKey = getAttachmentKey(rejection.file);
  const name = rejection.file?.name || "Unknown file";
  const messages = rejection.errors.map((error) => {
    if (error.code === "file-too-large") {
      return "File too large (max 50MB)";
    }
    if (error.code === "too-many-files") {
      return "Too many files (max 5)";
    }
    return error.message;
  });

  return {
    attachmentKey,
    message: `${name}: ${messages.join(", ") || "File rejected"}`,
  };
}

const isTemporarySessionId = (sessionId: string | null | undefined) =>
  Boolean(
    sessionId
    && (
      sessionId.startsWith("new-session-")
      || sessionId.startsWith("temp-")
    ),
  );

const BTW_TRANSCRIPT_MAX_CHARS = 120_000;

function buildBtwTranscript(messages: ChatMessage[]): string {
  const lines: string[] = [];
  for (const m of messages) {
    if (m.type !== 'user' && m.type !== 'assistant') {
      continue;
    }
    const raw = typeof m.content === 'string' ? m.content : '';
    const text = raw.trim();
    if (!text) {
      continue;
    }
    const label = m.type === 'user' ? 'User' : 'Assistant';
    lines.push(`${label}: ${text}`);
  }
  let out = lines.join('\n\n');
  if (out.length > BTW_TRANSCRIPT_MAX_CHARS) {
    let cutPos = out.length - BTW_TRANSCRIPT_MAX_CHARS;
    const nextBoundary = out.indexOf('\n\n', cutPos);
    if (nextBoundary !== -1 && nextBoundary < cutPos + 2000) {
      cutPos = nextBoundary + 2;
    }
    out = '…(earlier messages omitted)\n\n' + out.slice(cutPos);
  }
  return out;
}

const getRouteSessionId = () => {
  if (typeof window === "undefined") {
    return null;
  }

  const match = window.location.pathname.match(/^\/session\/([^/]+)$/);
  if (!match?.[1]) {
    return null;
  }

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
};

const getOptimisticSessionDisplayName = (input: string) => {
  const firstLine = input
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);

  if (!firstLine) {
    return "New Session";
  }

  return firstLine.length > 80 ? `${firstLine.slice(0, 80)}...` : firstLine;
};

export function resolvePreferredCodexSessionId({
  selectedSessionId = null,
  routedSessionId = null,
  currentSessionId = null,
  pendingViewSessionId = null,
  pendingSessionId = null,
  lastSubmittedSessionId = null,
}: {
  selectedSessionId?: string | null;
  routedSessionId?: string | null;
  currentSessionId?: string | null;
  pendingViewSessionId?: string | null;
  pendingSessionId?: string | null;
  lastSubmittedSessionId?: string | null;
}): string | null {
  return (
    selectedSessionId ||
    routedSessionId ||
    currentSessionId ||
    pendingViewSessionId ||
    pendingSessionId ||
    lastSubmittedSessionId ||
    null
  );
}

export function useChatComposerState({
  selectedProject,
  selectedSession,
  currentSessionId,
  provider,
  permissionMode,
  cyclePermissionMode,
  codexModel,
  isLoading,
  canAbortSession,
  tokenBudget,
  sendMessage,
  sendByCtrlEnter,
  onSessionActive,
  onSessionProcessing,
  onInputFocusChange,
  onFileOpen,
  onShowSettings,
  processingSessions,
  pendingViewSessionRef,
  scrollToBottom,
  setChatMessages,
  setSessionMessages,
  setIsLoading,
  setCanAbortSession,
  setClaudeStatus,
  setIsUserScrolledUp,
  setPendingPermissionRequests,
  newSessionMode = "research",
  getChatMessagesForBtw,
}: UseChatComposerStateArgs) {
  const { t } = useTranslation("chat");
  const { pathname } = useLocation();
  const initialDraftBucket =
    selectedSession?.id || currentSessionId || pendingViewSessionRef.current?.sessionId || "new";
  const initialDraftStorageKey = buildDraftInputStorageKey(
    selectedProject?.name || null,
    normalizeProvider(provider),
    initialDraftBucket,
  );
  const [input, setInput] = useState(() => {
    if (typeof window !== "undefined" && initialDraftStorageKey) {
      return safeLocalStorage.getItem(initialDraftStorageKey) || "";
    }
    return "";
  });
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState<Map<string, number>>(
    new Map(),
  );
  const [fileErrors, setFileErrors] = useState<Map<string, string>>(new Map());
  const [isTextareaExpanded, setIsTextareaExpanded] = useState(false);
  const [thinkingMode, setThinkingMode] = useState("none");
  const [codexReasoningEffort, setCodexReasoningEffort] =
    useState<CodexReasoningEffortId>(() => {
      const savedValue = safeLocalStorage.getItem("codex-reasoning-effort");
      switch (savedValue) {
        case "minimal":
        case "low":
        case "medium":
        case "high":
        case "xhigh":
        case "default":
          return savedValue;
        default:
          return "default";
      }
    });
  const [intakeGreeting, setIntakeGreeting] = useState<string | null>(null);
  const [btwOverlay, setBtwOverlay] = useState<BtwOverlayState>(CLOSED_BTW_OVERLAY);
  const btwAbortRef = useRef<AbortController | null>(null);
  const closeBtwOverlay = useCallback(() => {
    btwAbortRef.current?.abort();
    btwAbortRef.current = null;
    setBtwOverlay(CLOSED_BTW_OVERLAY);
  }, []);
  const [pendingStageTagKeys, setPendingStageTagKeys] = useState<string[]>([]);
  const [attachedPrompt, setAttachedPrompt] = useState<AttachedPrompt | null>(
    null,
  );

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputHighlightRef = useRef<HTMLDivElement>(null);
  const handleSubmitRef = useRef<
    | ((
        event:
          | FormEvent<HTMLFormElement>
          | MouseEvent
          | TouchEvent
          | KeyboardEvent<HTMLTextAreaElement>,
      ) => Promise<void>)
    | null
  >(null);
  // Programmatic draft loads and async submit callbacks must read the latest composer state
  // without waiting for a rerender, so the mutable refs intentionally mirror state here.
  const inputValueRef = useRef(input);
  const attachedFilesRef = useRef<File[]>([]);
  const attachedPromptRef = useRef<AttachedPrompt | null>(null);
  const pendingStageTagKeysRef = useRef<string[]>([]);
  const inputStateBySessionRef = useRef<SessionInputStateMap>({});
  const lastSubmittedCodexSessionRef = useRef<string | null>(null);
  const textareaLayoutTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingEditedMessageIdRef = useRef<string | null>(null);
  const normalizedProvider = normalizeProvider(provider);
  const currentProjectName = selectedProject?.name || null;
  const activeDraftBucket =
    selectedSession?.id || currentSessionId || pendingViewSessionRef.current?.sessionId || "new";
  const draftStorageKey = useMemo(
    () =>
      buildDraftInputStorageKey(
        currentProjectName,
        normalizedProvider,
        activeDraftBucket,
      ),
    [activeDraftBucket, currentProjectName, normalizedProvider],
  );

  const hasProcessingSession = useCallback(
    (
      sessionId: string | null | undefined,
      providerOverride: SessionProvider | string | null | undefined = normalizedProvider,
      projectNameOverride: string | null | undefined = currentProjectName,
    ) => {
      if (!sessionId || !processingSessions || !projectNameOverride) {
        return false;
      }

      const scopeKey = buildSessionScopeKey(
        projectNameOverride,
        providerOverride || normalizedProvider,
        sessionId,
      );

      if (scopeKey && processingSessions.has(scopeKey)) {
        return true;
      }

      if (processingSessions.has(sessionId)) {
        return true;
      }

      const normalizedProviderOverride = normalizeProvider(
        (providerOverride || normalizedProvider) as SessionProvider,
      );

      return Array.from(processingSessions).some((trackingKey) => {
        if (!scopeKeyMatchesSessionId(trackingKey, sessionId)) {
          return false;
        }

        const parsedScope = parseSessionScopeKey(trackingKey);
        if (!parsedScope) {
          return trackingKey === sessionId;
        }

        return (
          parsedScope.projectName === projectNameOverride &&
          parsedScope.provider === normalizedProviderOverride
        );
      });
    },
    [currentProjectName, normalizedProvider, processingSessions],
  );

  useEffect(() => {
    setPendingStageTagKeys([]);
    pendingEditedMessageIdRef.current = null;
  }, [selectedProject?.name, selectedSession?.id]);

  useEffect(() => {
    attachedFilesRef.current = attachedFiles;
  }, [attachedFiles]);

  useEffect(() => {
    attachedPromptRef.current = attachedPrompt;
  }, [attachedPrompt]);

  useEffect(() => {
    pendingStageTagKeysRef.current = pendingStageTagKeys;
  }, [pendingStageTagKeys]);

  useEffect(() => {
    safeLocalStorage.setItem("codex-reasoning-effort", codexReasoningEffort);
  }, [codexReasoningEffort]);

  useEffect(() => {
    const supportedEfforts = getSupportedCodexReasoningEfforts(codexModel);
    if (!supportedEfforts.includes(codexReasoningEffort)) {
      setCodexReasoningEffort("default");
    }
  }, [codexModel, codexReasoningEffort]);

  const handleBuiltInCommand = useCallback(
    (result: CommandExecutionResult) => {
      const { action, data } = result;
      switch (action) {
        case "clear":
          setChatMessages([]);
          setSessionMessages?.([]);
          break;

        case "help":
          setChatMessages((previous) => [
            ...previous,
            {
              type: "assistant",
              content: data.content,
              timestamp: Date.now(),
            },
          ]);
          break;

        case "model":
          setChatMessages((previous) => [
            ...previous,
            {
              type: "assistant",
              content: `**Current Model**: ${data.current.model}\n\n**Available Models**:\n\nCodex: ${(data.available?.codex || []).join(", ")}`,
              timestamp: Date.now(),
            },
          ]);
          break;

        case "cost": {
          const costMessage = `**Token Usage**: ${data.tokenUsage.used.toLocaleString()} / ${data.tokenUsage.total.toLocaleString()} (${data.tokenUsage.percentage}%)\n\n**Estimated Cost**:\n- Input: $${data.cost.input}\n- Output: $${data.cost.output}\n- **Total**: $${data.cost.total}\n\n**Model**: ${data.model}`;
          setChatMessages((previous) => [
            ...previous,
            { type: "assistant", content: costMessage, timestamp: Date.now() },
          ]);
          break;
        }

        case "status": {
          const statusMessage = `**System Status**\n\n- Version: ${data.version}\n- Uptime: ${data.uptime}\n- Model: ${data.model}\n- Provider: ${data.provider}\n- Node.js: ${data.nodeVersion}\n- Platform: ${data.platform}`;
          setChatMessages((previous) => [
            ...previous,
            {
              type: "assistant",
              content: statusMessage,
              timestamp: Date.now(),
            },
          ]);
          break;
        }

        case "memory":
          if (data.error) {
            setChatMessages((previous) => [
              ...previous,
              {
                type: "assistant",
                content: `閳跨媴绗?${data.message}`,
                timestamp: Date.now(),
              },
            ]);
          } else {
            setChatMessages((previous) => [
              ...previous,
              {
                type: "assistant",
                content: `棣冩憫 ${data.message}\n\nPath: \`${data.path}\``,
                timestamp: Date.now(),
              },
            ]);
            if (data.exists && onFileOpen) {
              onFileOpen(data.path);
            }
          }
          break;

        case "config":
          onShowSettings?.();
          break;

        case "rewind":
          if (data.error) {
            setChatMessages((previous) => [
              ...previous,
              {
                type: "assistant",
                content: `閳跨媴绗?${data.message}`,
                timestamp: Date.now(),
              },
            ]);
          } else {
            setChatMessages((previous) => previous.slice(0, -data.steps * 2));
            setChatMessages((previous) => [
              ...previous,
              {
                type: "assistant",
                content: `閳?${data.message}`,
                timestamp: Date.now(),
              },
            ]);
          }
          break;

        default:
          console.warn("Unknown built-in command action:", action);
      }
    },
    [onFileOpen, onShowSettings, setChatMessages, setSessionMessages],
  );

  const handleCustomCommand = useCallback(
    async (result: CommandExecutionResult) => {
      const { content, hasBashCommands } = result;

      if (hasBashCommands) {
        const confirmed = window.confirm(
          "This command contains bash commands that will be executed. Do you want to proceed?",
        );
        if (!confirmed) {
          setChatMessages((previous) => [
            ...previous,
            {
              type: "assistant",
              content: "閴?Command execution cancelled",
              timestamp: Date.now(),
            },
          ]);
          return;
        }
      }

      const commandContent = content || "";
      setInput(commandContent);
      inputValueRef.current = commandContent;

      // Defer submit to next tick so the command text is reflected in UI before dispatching.
      setTimeout(() => {
        if (handleSubmitRef.current) {
          handleSubmitRef.current(createFakeSubmitEvent());
        }
      }, 0);
    },
    [setChatMessages],
  );

  const executeCommand = useCallback(
    async (command: SlashCommand, rawInput?: string) => {
      if (!command || !selectedProject) {
        return;
      }

      try {
        const effectiveInput = rawInput ?? input;
        const commandMatch = effectiveInput.match(
          new RegExp(`${escapeRegExp(command.name)}\\s*(.*)`),
        );
        const args =
          commandMatch && commandMatch[1]
            ? commandMatch[1].trim().split(/\s+/)
            : [];

        const context = {
          projectPath: selectedProject.fullPath || selectedProject.path,
          projectName: selectedProject.name,
          sessionId: currentSessionId,
          provider,
          model: codexModel,
          tokenUsage: tokenBudget,
        };

        const response = await authenticatedFetch("/api/commands/execute", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            commandName: command.name,
            commandPath: command.path,
            args,
            context,
          }),
        });

        if (!response.ok) {
          let errorMessage = `Failed to execute command (${response.status})`;
          try {
            const errorData = await response.json();
            errorMessage =
              errorData?.message || errorData?.error || errorMessage;
          } catch {
            // Ignore JSON parse failures and use fallback message.
          }
          throw new Error(errorMessage);
        }

        const result = (await response.json()) as CommandExecutionResult;
        if (result.type === 'builtin' && result.action === 'btw') {
          const { data } = result;
          setInput('');
          inputValueRef.current = '';
          if (data?.error) {
            setChatMessages((previous) => [
              ...previous,
              {
                type: 'assistant',
                content: `⚠️ ${data.error}`,
                timestamp: Date.now(),
              },
            ]);
            return;
          }
          const question = typeof data?.question === 'string' ? data.question.trim() : '';
          if (!question) {
            return;
          }
          btwAbortRef.current?.abort();
          const abortController = new AbortController();
          btwAbortRef.current = abortController;
          setBtwOverlay({
            open: true,
            question,
            answer: '',
            loading: true,
            error: null,
          });
          try {
            const transcript = buildBtwTranscript(getChatMessagesForBtw?.() ?? []);
            const btwModel = codexModel;
            const btwResponse = await authenticatedFetch('/api/btw', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                question,
                transcript,
                projectPath: selectedProject.fullPath || selectedProject.path,
                model: btwModel,
                provider,
              }),
              signal: abortController.signal,
            });
            const payload = (await btwResponse.json().catch(() => ({}))) as {
              answer?: string;
              error?: string;
              message?: string;
            };
            if (!btwResponse.ok) {
              throw new Error(payload?.error || payload?.message || `Request failed (${btwResponse.status})`);
            }
            setBtwOverlay((previous) => ({
              ...previous,
              loading: false,
              answer: typeof payload.answer === 'string' ? payload.answer : '',
              error: null,
            }));
          } catch (btwErr) {
            if (abortController.signal.aborted) {
              return;
            }
            const msg = btwErr instanceof Error ? btwErr.message : 'Unknown error';
            setBtwOverlay((previous) => ({
              ...previous,
              loading: false,
              error: msg,
              answer: '',
            }));
          }
          return;
        }
        if (result.type === "builtin") {
          handleBuiltInCommand(result);
          setInput("");
          inputValueRef.current = "";
        } else if (result.type === "custom") {
          await handleCustomCommand(result);
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        console.error("Error executing command:", error);
        setChatMessages((previous) => [
          ...previous,
          {
            type: "assistant",
            content: `Error executing command: ${message}`,
            timestamp: Date.now(),
          },
        ]);
      }
    },
    [
      codexModel,
      currentSessionId,
      getChatMessagesForBtw,
      handleBuiltInCommand,
      handleCustomCommand,
      input,
      provider,
      selectedProject,
      setChatMessages,
      tokenBudget,
    ],
  );

  const {
    slashCommands,
    slashCommandsCount,
    filteredCommands,
    frequentCommands,
    commandQuery,
    showCommandMenu,
    selectedCommandIndex,
    resetCommandMenuState,
    handleCommandSelect,
    handleToggleCommandMenu,
    handleCommandInputChange,
    handleCommandMenuKeyDown,
  } = useSlashCommands({
    selectedProject,
    input,
    setInput,
    textareaRef,
    onExecuteCommand: executeCommand,
  });

  const applyProgrammaticDraft = useCallback((draft: ProgrammaticMessageDraft) => {
    if (
      hasUnsavedComposerDraft(
        inputValueRef.current,
        attachedFilesRef.current,
        attachedPromptRef.current,
      )
    ) {
      const confirmed = window.confirm(
        t('messageActions.confirmReplaceDraft', {
          defaultValue: 'Replace your current unsent draft with this message?',
        }),
      );
      if (!confirmed) {
        return false;
      }
    }

    const normalizedDraft = normalizeProgrammaticDraft(draft);

    setInput(normalizedDraft.content);
    inputValueRef.current = normalizedDraft.content;
    setAttachedPrompt(normalizedDraft.attachedPrompt);
    attachedPromptRef.current = normalizedDraft.attachedPrompt;

    setAttachedFiles([]);
    attachedFilesRef.current = [];
    setUploadingFiles(new Map());
    setFileErrors(new Map());
    setPendingStageTagKeys([]);
    pendingStageTagKeysRef.current = [];
    pendingEditedMessageIdRef.current = draft.editingMessageId ?? null;
    resetCommandMenuState();
    return true;
  }, [resetCommandMenuState, t]);

  const submitProgrammaticMessage = useCallback((draft: ProgrammaticMessageDraft) => {
    const didApplyDraft = applyProgrammaticDraft(draft);
    if (!didApplyDraft) {
      return false;
    }

    const attemptSubmit = (attempt = 0) => {
      if (handleSubmitRef.current) {
        handleSubmitRef.current(createFakeSubmitEvent());
        return;
      }

      if (attempt >= PROGRAMMATIC_SUBMIT_MAX_RETRIES) {
        console.warn('[Chat] Programmatic submit skipped because handleSubmit was not ready');
        return;
      }

      setTimeout(() => {
        attemptSubmit(attempt + 1);
      }, PROGRAMMATIC_SUBMIT_RETRY_DELAY_MS);
    };

    setTimeout(() => {
      attemptSubmit();
    }, 0);
    return true;
  }, [applyProgrammaticDraft]);

  const submitProgrammaticInput = useCallback((content: string, options?: { attachedPrompt?: AttachedPrompt | null }) => {
    submitProgrammaticMessage({
      content,
      attachedPrompt: options?.attachedPrompt ?? null,
    });
  }, [submitProgrammaticMessage]);

  const {
    showFileDropdown,
    filteredFiles,
    selectedFileIndex,
    renderInputWithMentions,
    selectFile,
    setCursorPosition,
    handleFileMentionsKeyDown,
  } = useFileMentions({
    selectedProject,
    input,
    setInput,
    textareaRef,
  });

  const syncInputOverlayScroll = useCallback((target: HTMLTextAreaElement) => {
    if (!inputHighlightRef.current || !target) {
      return;
    }
    inputHighlightRef.current.scrollTop = target.scrollTop;
    inputHighlightRef.current.scrollLeft = target.scrollLeft;
  }, []);

  const syncTextareaLayout = useCallback((nextValue: string, focus: boolean) => {
    if (textareaLayoutTimeoutRef.current) {
      clearTimeout(textareaLayoutTimeoutRef.current);
    }

    textareaLayoutTimeoutRef.current = setTimeout(() => {
      textareaLayoutTimeoutRef.current = null;
      const textarea = textareaRef.current;
      if (!textarea) {
        return;
      }

      if (focus) {
        textarea.focus();
      }

      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
      const cursor = nextValue.length;
      textarea.setSelectionRange(cursor, cursor);
      syncInputOverlayScroll(textarea);

      const computedStyle = window.getComputedStyle(textarea);
      const lineHeight = resolveLineHeightPx(computedStyle.lineHeight, computedStyle.fontSize);
      setIsTextareaExpanded(textarea.scrollHeight > lineHeight * 2);
    }, 0);
  }, [syncInputOverlayScroll]);

  const loadMessageIntoComposer = useCallback((draft: ProgrammaticMessageDraft) => {
    const didApplyDraft = applyProgrammaticDraft(draft);
    if (!didApplyDraft) {
      return false;
    }

    const normalizedDraft = normalizeProgrammaticDraft(draft);
    syncTextareaLayout(normalizedDraft.content, true);
    return true;
  }, [applyProgrammaticDraft, syncTextareaLayout]);

  const handleAttachmentFiles = useCallback((files: File[]) => {
    const validFiles: File[] = [];

    files.forEach((file) => {
      try {
        if (!file || typeof file !== "object") {
          console.warn("Invalid file object:", file);
          return;
        }

        const attachmentKey = getAttachmentKey(file);

        if (!file.size) {
          setFileErrors((previous) => {
            const next = new Map(previous);
            next.set(
              attachmentKey,
              `${file.name || "Unknown file"}: Empty files are not supported`,
            );
            return next;
          });
          return;
        }

        if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
          setFileErrors((previous) => {
            const next = new Map(previous);
            next.set(
              attachmentKey,
              `${file.name || "Unknown file"}: File too large (max 50MB)`,
            );
            return next;
          });
          return;
        }

        validFiles.push(file);
      } catch (error) {
        console.error("Error validating file:", error, file);
      }
    });

    if (validFiles.length > 0) {
      setFileErrors((previous) => {
        const next = new Map(previous);
        validFiles.forEach((file) => {
          next.delete(getAttachmentKey(file));
        });
        return next;
      });

      setAttachedFiles((previous) => {
        const deduped = [...previous];
        validFiles.forEach((file) => {
          const nextKey = getAttachmentKey(file);
          if (
            !deduped.some((existing) => getAttachmentKey(existing) === nextKey)
          ) {
            deduped.push(file);
          }
        });
        return deduped.slice(0, MAX_ATTACHMENTS);
      });
    }
  }, []);

  const handleRejectedFiles = useCallback((rejections: FileRejection[]) => {
    if (!Array.isArray(rejections) || rejections.length === 0) {
      return;
    }

    setFileErrors((previous) => {
      const next = new Map(previous);
      rejections.forEach((rejection) => {
        const { attachmentKey, message } = formatRejectedFileMessage(rejection);
        next.set(attachmentKey, message);
      });
      return next;
    });
  }, []);

  const removeAttachedFile = useCallback((index: number) => {
    setAttachedFiles((previous) => {
      const next = [...previous];
      const [removedFile] = next.splice(index, 1);

      if (removedFile) {
        const attachmentKey = getAttachmentKey(removedFile);
        setFileErrors((previousErrors) => {
          const nextErrors = new Map(previousErrors);
          nextErrors.delete(attachmentKey);
          return nextErrors;
        });
        setUploadingFiles((previousUploads) => {
          const nextUploads = new Map(previousUploads);
          nextUploads.delete(attachmentKey);
          return nextUploads;
        });
      }

      return next;
    });
  }, []);

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const items = Array.from(event.clipboardData.items);

      items.forEach((item) => {
        if (item.kind !== "file") {
          return;
        }
        const file = item.getAsFile();
        if (file) {
          handleAttachmentFiles([file]);
        }
      });

      if (items.length === 0 && event.clipboardData.files.length > 0) {
        const files = Array.from(event.clipboardData.files);
        if (files.length > 0) {
          handleAttachmentFiles(files);
        }
      }
    },
    [handleAttachmentFiles],
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    maxSize: MAX_ATTACHMENT_SIZE_BYTES,
    maxFiles: MAX_ATTACHMENTS,
    onDrop: handleAttachmentFiles,
    onDropRejected: handleRejectedFiles,
    noClick: true,
    noKeyboard: true,
  });

  const uploadPreviewImages = useCallback(
    async (files: File[]) => {
      if (files.length === 0) {
        return [];
      }

      const formData = new FormData();
      files.forEach((file) => {
        formData.append("images", file);
      });

      const response = await authenticatedFetch(
        `/api/projects/${encodeURIComponent(selectedProject?.name || "")}/upload-images`,
        {
          method: "POST",
          headers: {},
          body: formData,
        },
      );

      if (!response.ok) {
        throw new Error("Failed to upload images");
      }

      const result = await response.json();
      return Array.isArray(result.images) ? (result.images as ChatImage[]) : [];
    },
    [selectedProject?.name],
  );

  const uploadFilesToProject = useCallback(
    async (files: File[]) => {
      if (!selectedProject || files.length === 0) {
        return [];
      }

      const formData = new FormData();
      const targetDir = `${CODEX_ATTACHMENT_DIR}/${Date.now()}`;
      formData.append("targetDir", targetDir);
      files.forEach((file) => {
        formData.append("files", file);
      });

      const response = await authenticatedFetch(
        `/api/projects/${encodeURIComponent(selectedProject.name)}/upload-files`,
        {
          method: "POST",
          headers: {},
          body: formData,
        },
      );

      if (!response.ok) {
        throw new Error("Failed to upload files");
      }

      const result = await response.json();
      return Array.isArray(result.files)
        ? (result.files as UploadedProjectFile[])
        : [];
    },
    [selectedProject],
  );

  const resolveSessionContext = useCallback(() => {
    const routedSessionId = getRouteSessionId();
    const projectName = selectedProject?.name || null;

    // If we're on the root path with no routed session and no selected session,
    // treat this as an explicit new-session start and clear stale IDs.
    const isExplicitNewSessionStart =
      pathname === "/" &&
      !routedSessionId &&
      !selectedSession?.id;
    if (isExplicitNewSessionStart) {
      clearScopedPendingSessionId(projectName, "codex");
      lastSubmittedCodexSessionRef.current = null;
    }

    const pendingSessionId = readScopedPendingSessionId(projectName, "codex");
    const pendingViewSessionId =
      pendingViewSessionRef.current?.sessionId || null;
    const lastSubmittedSessionId = lastSubmittedCodexSessionRef.current;
    const effectiveSessionId = resolvePreferredCodexSessionId({
      selectedSessionId: selectedSession?.id || null,
      routedSessionId,
      currentSessionId,
      pendingViewSessionId,
      pendingSessionId,
      lastSubmittedSessionId,
    });
    const isNewSession = !effectiveSessionId;
    const sessionToActivate = effectiveSessionId || `new-session-${Date.now()}`;
    const resolvedProjectPath =
      selectedProject?.fullPath || selectedProject?.path || "";

    return {
      routedSessionId,
      effectiveSessionId,
      isNewSession,
      sessionToActivate,
      resolvedProjectPath,
    };
  }, [
    currentSessionId,
    pathname,
    pendingViewSessionRef,
    selectedProject?.fullPath,
    selectedProject?.path,
    selectedSession?.id,
  ]);



  const sendCodexTurn = useCallback(
    ({
      text,
      sessionId,
      projectName,
      projectPath,
      sessionMode,
      updateForegroundState = true,
      appendLocalUserMessage = true,
      turnKind = "start",
      expectedTurnId = undefined,
      clientTurnId = undefined,
      codexCommandText,
      attachments,
      images,
      stageTagKeys,
      stageTagSource,
      provisionalSessionId,
      resumeSessionId,
      model,
      permissionModeOverride,
      modelReasoningEffort,
      telemetryEnabled,
      includeSessionModeContext = false,
      resume = true,
    }: {
      text: string;
      sessionId: string;
      projectName?: string | null;
      projectPath: string;
      sessionMode: SessionMode;
      updateForegroundState?: boolean;
      appendLocalUserMessage?: boolean;
      turnKind?: "start" | "steer";
      expectedTurnId?: string;
      clientTurnId?: string;
      codexCommandText?: string;
      attachments?: { imagePaths: string[]; documentPaths: string[] };
      images?: ChatImage[];
      stageTagKeys?: string[];
      stageTagSource?: string;
      provisionalSessionId?: string;
      resumeSessionId?: string;
      model?: string;
      permissionModeOverride?: string;
      modelReasoningEffort?: string | undefined;
      telemetryEnabled?: boolean;
      includeSessionModeContext?: boolean;
      resume?: boolean;
    }) => {
      if (!text.trim() || !sessionId || !projectPath) {
        return;
      }

      const commandToSend = (() => {
        if (typeof codexCommandText === "string" && codexCommandText.trim().length > 0) {
          return codexCommandText;
        }
        if (includeSessionModeContext) {
          const sessionModeContext =
            sessionMode === "workspace_qa"
              ? "[Context: session-mode=workspace_qa]\n[Context: Treat this as a lightweight workspace Q&A session. Focus on answering questions about files, code, and project structure. Do not start the research intake or pipeline workflow unless the user explicitly asks for it.]\n\n"
              : "[Context: session-mode=research]\n[Context: This is a research workflow session. Follow the normal project research instructions and pipeline behavior.]\n\n";
          return `${sessionModeContext}${text}`;
        }
        return text;
      })();

      const turnStartTime = Date.now();

      if (appendLocalUserMessage) {
        setChatMessages((previous) => [
          ...previous,
          {
            type: "user",
            content: text,
            timestamp: new Date(),
          },
        ]);
      }

      if (updateForegroundState) {
        setIsLoading(true);
        setCanAbortSession(true);
        setClaudeStatus({
          text: "Processing",
          tokens: 0,
          can_interrupt: true,
          startTime: turnStartTime,
        });
        setIsUserScrolledUp(false);
        setTimeout(() => scrollToBottom(), 100);
      }

      persistSessionTimerStart(sessionId, turnStartTime);
      onSessionActive?.(sessionId, "codex", projectName || selectedProject?.name || null);
      onSessionProcessing?.(
        sessionId,
        "codex",
        projectName || selectedProject?.name || null,
      );
      lastSubmittedCodexSessionRef.current = sessionId;

      sendMessage({
        type: "codex-command",
        command: commandToSend,
        sessionId,
        options: {
          cwd: projectPath,
          projectPath,
          sessionId: resumeSessionId || sessionId,
          resume,
          model: model || codexModel,
          permissionMode:
            (permissionModeOverride || permissionMode) === "plan"
              ? "default"
              : (permissionModeOverride || permissionMode),
          modelReasoningEffort:
            modelReasoningEffort !== undefined
              ? modelReasoningEffort
              : codexReasoningEffort === "default"
                ? undefined
                : codexReasoningEffort,
          telemetryEnabled: telemetryEnabled ?? isTelemetryEnabled(),
          attachments,
          images,
          sessionMode,
          stageTagKeys,
          stageTagSource,
          clientTurnId:
            typeof clientTurnId === "string" && clientTurnId.trim().length > 0
              ? clientTurnId.trim()
              : undefined,
          projectName,
          provider: "codex",
          provisionalSessionId,
          resumeSessionId: resumeSessionId || undefined,
          turnKind: turnKind === "steer" ? "steer" : undefined,
          kind: turnKind === "steer" ? "steer" : undefined,
          expectedTurnId:
            turnKind === "steer" && expectedTurnId
              ? expectedTurnId
              : undefined,
          activeTurnId:
            turnKind === "steer" && expectedTurnId
              ? expectedTurnId
              : undefined,
        },
      });
    },
    [
      codexModel,
      codexReasoningEffort,
      onSessionActive,
      onSessionProcessing,
      permissionMode,
      scrollToBottom,
      sendMessage,
      setCanAbortSession,
      setChatMessages,
      setClaudeStatus,
      setIsLoading,
      setIsUserScrolledUp,
      selectedProject?.name,
    ],
  );

  const mergeMessageTextForComposer = useCallback((messages: CodexInputMessage[]) => {
    return messages
      .map((message) => String(message.text || "").trim())
      .filter(Boolean)
      .join("\n\n");
  }, []);

  const withSessionInputState = useCallback(
    (
      sessionId: string,
      updater: (state: ReturnType<typeof createEmptyCodexInputState>) => ReturnType<typeof createEmptyCodexInputState>,
    ) => {
      inputStateBySessionRef.current = upsertSessionInputState(
        inputStateBySessionRef.current,
        sessionId,
        updater,
      );
      return getSessionInputState(inputStateBySessionRef.current, sessionId);
    },
    [],
  );

  const dispatchCodexInputMessage = useCallback(
    (
      message: CodexInputMessage,
      sessionId: string,
      options?: {
        asSteer?: boolean;
        expectedTurnId?: string;
        appendLocalUserMessage?: boolean;
        isCurrentViewSession?: boolean;
        includeSessionModeContext?: boolean;
        codexCommandText?: string;
        model?: string;
        permissionModeOverride?: string;
        modelReasoningEffort?: string | undefined;
        telemetryEnabled?: boolean;
        attachments?: { imagePaths: string[]; documentPaths: string[] };
        images?: ChatImage[];
        stageTagKeys?: string[];
        stageTagSource?: string;
        provisionalSessionId?: string;
        resumeSessionId?: string;
        resume?: boolean;
      },
    ) => {
      const sessionMode =
        message.sessionMode ||
        selectedSession?.mode ||
        newSessionMode;
      const projectPath =
        message.projectPath ||
        selectedProject?.fullPath ||
        selectedProject?.path ||
        "";

      if (!projectPath) {
        setChatMessages((previous) => [
          ...previous,
          {
            type: "error",
            content: "Unable to execute queued message: project path is unavailable.",
            timestamp: new Date(),
          },
        ]);
        return false;
      }

      const turnKind = options?.asSteer ? "steer" : "start";
      sendCodexTurn({
        text: message.text,
        codexCommandText: options?.codexCommandText,
        sessionId,
        projectName: message.projectName || selectedProject?.name || currentProjectName,
        projectPath,
        sessionMode,
        updateForegroundState: options?.isCurrentViewSession !== false,
        appendLocalUserMessage: options?.appendLocalUserMessage !== false,
        turnKind,
        expectedTurnId: options?.expectedTurnId,
        clientTurnId: message.clientTurnId || message.id,
        includeSessionModeContext: options?.includeSessionModeContext === true,
        model: options?.model,
        permissionModeOverride: options?.permissionModeOverride,
        modelReasoningEffort: options?.modelReasoningEffort,
        telemetryEnabled: options?.telemetryEnabled,
        attachments: options?.attachments,
        images: options?.images,
        stageTagKeys: options?.stageTagKeys,
        stageTagSource: options?.stageTagSource,
        provisionalSessionId: options?.provisionalSessionId,
        resumeSessionId: options?.resumeSessionId,
        resume: options?.resume ?? true,
      });

      withSessionInputState(String(sessionId), (previous) => {
        const next = {
          ...previous,
          taskRunning: true,
          activeTurnId:
            turnKind === "steer"
              ? options?.expectedTurnId || previous.activeTurnId
              : previous.activeTurnId,
          sessionBinding: {
            provisionalSessionId:
              previous.sessionBinding?.provisionalSessionId ||
              (isTemporarySessionId(sessionId) ? sessionId : null),
            sessionId: isTemporarySessionId(sessionId)
              ? previous.sessionBinding?.sessionId || null
              : sessionId,
          },
        };
        return next;
      });

      return true;
    },
    [
      currentProjectName,
      newSessionMode,
      selectedProject?.fullPath,
      selectedProject?.name,
      selectedProject?.path,
      selectedSession?.mode,
      sendCodexTurn,
      setChatMessages,
      withSessionInputState,
    ],
  );

  const dispatchNextFromState = useCallback(
    (
      sessionId: string,
      options?: {
        ignoreProcessingCheck?: boolean;
      },
    ) => {
      if (!sessionId) {
        return;
      }

      const state = getSessionInputState(inputStateBySessionRef.current, sessionId);
      const isSessionProcessing = hasProcessingSession(
        sessionId,
        "codex",
        selectedProject?.name || currentProjectName,
      );

      if (state.taskRunning || (!options?.ignoreProcessingCheck && isSessionProcessing)) {
        return;
      }

      if (state.rejectedSteersQueue.length > 0) {
        const settled = reduceCodexTurnCompleted(state);
        const nextState = settled.state;
        inputStateBySessionRef.current = upsertSessionInputState(
          inputStateBySessionRef.current,
          sessionId,
          nextState,
        );
        const mergedDispatchMessage = resolveDispatchMessage(settled.resolution);
        if (mergedDispatchMessage) {
          const queuedMessage = createCodexInputMessage({
            ...mergedDispatchMessage,
            id: mergedDispatchMessage.id,
            clientTurnId: mergedDispatchMessage.clientTurnId || mergedDispatchMessage.id,
            projectName:
              mergedDispatchMessage.projectName || selectedProject?.name || currentProjectName || undefined,
          });
          dispatchCodexInputMessage(queuedMessage, sessionId, {
            appendLocalUserMessage: true,
            isCurrentViewSession: true,
            asSteer: false,
          });
        }
        return;
      }

      if (state.queuedUserMessages.length > 0) {
        const settled = reduceCodexTurnCompleted(state);
        const nextState = settled.state;
        inputStateBySessionRef.current = upsertSessionInputState(
          inputStateBySessionRef.current,
          sessionId,
          nextState,
        );
        const nextQueuedMessage = resolveDispatchMessage(settled.resolution);
        if (nextQueuedMessage) {
          dispatchCodexInputMessage(nextQueuedMessage, sessionId, {
            appendLocalUserMessage: true,
            isCurrentViewSession: true,
            asSteer: false,
          });
        }
      }
    },
    [
      currentProjectName,
      dispatchCodexInputMessage,
      hasProcessingSession,
      selectedProject?.name,
    ],
  );

  const handleCodexTurnStarted = useCallback(
    (sessionId?: string | null, turnId?: string | null) => {
      if (!sessionId) {
        return;
      }
      withSessionInputState(String(sessionId), (previous) =>
        reduceCodexTurnStarted(previous, turnId || selectedSession?.activeTurnId || null),
      );
    },
    [selectedSession?.activeTurnId, withSessionInputState],
  );

  const handleCodexSteerCommitted = useCallback(
    (sessionId?: string | null, compareKey?: Record<string, unknown> | null) => {
      if (!sessionId) {
        return;
      }
      withSessionInputState(String(sessionId), (previous) =>
        reduceCodexSteerCommitted(previous, compareKey || null),
      );
    },
    [withSessionInputState],
  );

  const handleCodexSteerRejected = useCallback(
    (payload?: {
      sessionId?: string | null;
      clientTurnId?: string | null;
      turnKind?: string | null;
    }) => {
      const sessionId = payload?.sessionId || null;
      if (!sessionId) {
        return;
      }

      withSessionInputState(String(sessionId), (previous) => {
        const rejection = {
          clientTurnId: payload?.clientTurnId || null,
          turnKind: payload?.turnKind || null,
          rejectedAt: Date.now(),
        };
        return reduceCodexSteerRejected(previous, rejection);
      });
    },
    [withSessionInputState],
  );

  const handleCodexTurnSettled = useCallback(
    (
      sessionId?: string | null,
      outcome: "complete" | "error" | "aborted" = "complete",
    ) => {
      if (!sessionId) {
        return;
      }

      const current = getSessionInputState(inputStateBySessionRef.current, sessionId);

      if (outcome === "aborted") {
        const aborted = reduceCodexTurnAborted(current, {
          interruptForPendingSteers: current.interruptRequestedForPendingSteers,
        });
        inputStateBySessionRef.current = upsertSessionInputState(
          inputStateBySessionRef.current,
          sessionId,
          aborted.state,
        );

        const abortedDispatchMessage = resolveDispatchMessage(aborted.resolution);
        if (abortedDispatchMessage) {
          dispatchCodexInputMessage(abortedDispatchMessage, sessionId, {
            appendLocalUserMessage: true,
            isCurrentViewSession: true,
            asSteer: false,
          });
          return;
        }

        if (aborted.state.composerDraft) {
          const mergedDraftText = mergeMessageTextForComposer([
            aborted.state.composerDraft,
          ]);
          setInput(mergedDraftText);
          inputValueRef.current = mergedDraftText;
          syncTextareaLayout(mergedDraftText, true);
        }
        return;
      }

      withSessionInputState(String(sessionId), (previous) => {
        const next = {
          ...previous,
          taskRunning: false,
          activeTurnId: null,
        };
        return next;
      });

      dispatchNextFromState(String(sessionId), { ignoreProcessingCheck: true });
    },
    [
      dispatchCodexInputMessage,
      dispatchNextFromState,
      mergeMessageTextForComposer,
      setInput,
      syncTextareaLayout,
      withSessionInputState,
    ],
  );

  const handleCodexSessionIdResolved = useCallback(
    (previousSessionId?: string | null, actualSessionId?: string | null) => {
      if (
        !previousSessionId ||
        !actualSessionId ||
        previousSessionId === actualSessionId
      ) {
        return;
      }

      if (lastSubmittedCodexSessionRef.current === previousSessionId) {
        lastSubmittedCodexSessionRef.current = actualSessionId;
      }

      inputStateBySessionRef.current = reconcileSessionInputStateId(
        inputStateBySessionRef.current,
        previousSessionId,
        actualSessionId,
      );

      const resolvedState = getSessionInputState(inputStateBySessionRef.current, actualSessionId);
      inputStateBySessionRef.current = upsertSessionInputState(
        inputStateBySessionRef.current,
        actualSessionId,
        updateSessionBinding(resolvedState, {
          provisionalSessionId:
            resolvedState.sessionBinding?.provisionalSessionId ||
            (isTemporarySessionId(previousSessionId) ? previousSessionId : null),
          sessionId: actualSessionId,
        }),
      );
    },
    [],
  );

  const handleCodexSessionStatusUpdate = useCallback(
    (sessionId?: string | null, isProcessing?: boolean) => {
      if (!sessionId) {
        return;
      }

      withSessionInputState(String(sessionId), (previous) => ({
        ...previous,
        taskRunning: Boolean(isProcessing),
      }));

      if (!isProcessing) {
        dispatchNextFromState(String(sessionId));
      }
    },
    [dispatchNextFromState, withSessionInputState],
  );

  const activeQueueSessionId =
    selectedSession?.id ||
    getRouteSessionId() ||
    currentSessionId ||
    pendingViewSessionRef.current?.sessionId ||
    lastSubmittedCodexSessionRef.current ||
    null;

  const activeInputState = activeQueueSessionId
    ? getSessionInputState(inputStateBySessionRef.current, activeQueueSessionId)
    : createEmptyCodexInputState();

  const rejectedSteersPreview = activeInputState.rejectedSteersQueue;
  const pendingSteersPreview = activeInputState.pendingSteers;
  const queuedFollowupPreview = activeInputState.queuedUserMessages;

  const restoreLastQueuedToComposer = useCallback(() => {
    if (!activeQueueSessionId) {
      return;
    }

    const state = getSessionInputState(inputStateBySessionRef.current, activeQueueSessionId);
    const { state: nextState, popped } = popLastQueuedMessage(state);
    inputStateBySessionRef.current = upsertSessionInputState(
      inputStateBySessionRef.current,
      activeQueueSessionId,
      nextState,
    );
    if (popped) {
      setInput(popped.text || "");
      inputValueRef.current = popped.text || "";
      syncTextareaLayout(popped.text || "", true);
    }
  }, [activeQueueSessionId, setInput, syncTextareaLayout]);

  const handleSubmit = useCallback(
    async (
      event:
        | FormEvent<HTMLFormElement>
        | MouseEvent
        | TouchEvent
        | KeyboardEvent<HTMLTextAreaElement>,
      options: {
        intent?: "submit" | "queue";
      } = {},
    ) => {
      event.preventDefault();
      const submitIntent = options.intent || "submit";
      const currentInput = inputValueRef.current;
      if (
        (!currentInput.trim() &&
          attachedFiles.length === 0 &&
          !attachedPrompt) ||
        !selectedProject
      ) {
        return;
      }

      const currentAttachedFiles = attachedFilesRef.current;
      const currentAttachedPrompt = attachedPromptRef.current;
      const currentStageTagKeys = pendingStageTagKeysRef.current;

      const trimmedInput = currentInput.trim();
      if (trimmedInput.startsWith("/")) {
        const firstSpace = trimmedInput.indexOf(" ");
        const commandName =
          firstSpace > 0 ? trimmedInput.slice(0, firstSpace) : trimmedInput;
        const matchedCommand = slashCommands.find(
          (command: SlashCommand) => command.name === commandName,
        );

        if (matchedCommand) {
          if (isLoading && commandName !== '/btw') {
            return;
          }
          await executeCommand(matchedCommand, trimmedInput);
          setInput("");
          inputValueRef.current = "";
          setAttachedPrompt(null);
          attachedPromptRef.current = null;
          pendingEditedMessageIdRef.current = null;
          setAttachedFiles([]);
          attachedFilesRef.current = [];
          setUploadingFiles(new Map());
          setFileErrors(new Map());
          setPendingStageTagKeys([]);
          pendingStageTagKeysRef.current = [];
          resetCommandMenuState();
          setIsTextareaExpanded(false);
          if (textareaRef.current) {
            textareaRef.current.style.height = "auto";
          }
          return;
        }
      }

      const normalizedInput =
        currentInput.trim() ||
        t("input.attachmentOnlyFallback", {
          defaultValue:
            "Please inspect the attached files and help me with them.",
        });
      let messageContent = normalizedInput;

      // Prepend attached prompt text if present
      if (currentAttachedPrompt) {
        if (currentInput.trim()) {
          messageContent = `${currentAttachedPrompt.promptText}\n\n${normalizedInput}`;
        } else {
          messageContent = currentAttachedPrompt.promptText;
        }
      }

      const selectedThinkingMode = thinkingModes.find(
        (mode: { id: string; prefix?: string }) => mode.id === thinkingMode,
      );
      if (selectedThinkingMode && selectedThinkingMode.prefix) {
        messageContent = `${selectedThinkingMode.prefix}: ${messageContent}`;
      }

      if (intakeGreeting) {
        setChatMessages((previous) => [
          ...previous,
          {
            type: "assistant",
            content: intakeGreeting,
            timestamp: new Date(),
          },
        ]);
        messageContent = `[Context: You have already greeted me as Lingzhi Lab's research assistant and asked about my research project. Continue the intake conversation without re-greeting.]\n\n${messageContent}`;
        setIntakeGreeting(null);
      }

      const {
        effectiveSessionId,
        isNewSession,
        sessionToActivate,
        resolvedProjectPath,
      } = resolveSessionContext();
      const isCurrentViewSession =
        !selectedSession?.id ||
        selectedSession.id === sessionToActivate ||
        currentSessionId === sessionToActivate;
      const isCodexSessionBusy =
        hasProcessingSession(
          sessionToActivate,
          "codex",
          selectedProject?.name || currentProjectName,
        ) ||
        (isLoading && isCurrentViewSession);
      const shouldQueueForThisSubmit =
        submitIntent === "queue" && provider === "codex" && isCodexSessionBusy;
      const useSteerForThisSubmit = isCodexSessionBusy && !shouldQueueForThisSubmit;
      const activeTurnIdForSubmit =
        typeof selectedSession?.activeTurnId === "string" &&
        selectedSession.activeTurnId.trim().length > 0
          ? selectedSession.activeTurnId.trim()
          : undefined;

      if (isCodexSessionBusy) {
        if (useSteerForThisSubmit) {
          if (attachedFiles.length > 0) {
            setChatMessages((previous) => [
              ...previous,
              {
                type: "error",
                content:
                  "Steer during an active turn currently supports text-only input. Remove attachments and resend.",
                timestamp: new Date(),
              },
            ]);
            return;
          }

          const steerMessage = createCodexInputMessage({
            id:
              typeof crypto !== "undefined" &&
              typeof crypto.randomUUID === "function"
                ? crypto.randomUUID()
                : `steer-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
            text: messageContent,
            textElements: [],
            localImages: [],
            remoteImageUrls: [],
            mentionBindings: [],
            createdAt: Date.now(),
            projectName: selectedProject.name,
            projectPath: resolvedProjectPath,
            sessionMode: selectedSession?.mode || newSessionMode,
            expectedTurnId: activeTurnIdForSubmit,
          });

          const submitOutcome = reduceCodexInputSubmit(
            getSessionInputState(inputStateBySessionRef.current, sessionToActivate),
            steerMessage,
            "steer",
          );
          inputStateBySessionRef.current = upsertSessionInputState(
            inputStateBySessionRef.current,
            sessionToActivate,
            submitOutcome.state,
          );

          const steerDispatchTarget =
            activeTurnIdForSubmit ||
            getSessionInputState(inputStateBySessionRef.current, sessionToActivate).activeTurnId ||
            undefined;

          if (steerDispatchTarget) {
            dispatchCodexInputMessage(steerMessage, sessionToActivate, {
              asSteer: true,
              expectedTurnId: steerDispatchTarget,
              appendLocalUserMessage: false,
              isCurrentViewSession,
            });
          } else {
            withSessionInputState(sessionToActivate, (previous) =>
              reduceCodexSteerRejected(previous, {
                clientTurnId: steerMessage.clientTurnId || steerMessage.id,
                turnKind: "steer",
                rejectedAt: Date.now(),
              }, steerMessage),
            );
            setChatMessages((previous) => [
              ...previous,
              {
                type: "error",
                content:
                  "Unable to send steer: no active turn is available for this session.",
                timestamp: new Date(),
              },
            ]);
          }

          setInput("");
          inputValueRef.current = "";
          setPendingStageTagKeys([]);
          resetCommandMenuState();
          setAttachedPrompt(null);
          setAttachedFiles([]);
          setUploadingFiles(new Map());
          setFileErrors(new Map());
          setIsTextareaExpanded(false);
          setThinkingMode("none");
          if (draftStorageKey) {
            safeLocalStorage.removeItem(draftStorageKey);
          }
          if (textareaRef.current) {
            textareaRef.current.style.height = "auto";
          }
          return;
        }

        if (attachedFiles.length > 0) {
          setChatMessages((previous) => [
            ...previous,
            {
              type: "error",
              content:
                "Queued Codex turns currently support text-only input. Remove attachments and resend.",
              timestamp: new Date(),
            },
          ]);
          return;
        }

        const queuedMessage = createCodexInputMessage({
          id:
            typeof crypto !== "undefined" &&
            typeof crypto.randomUUID === "function"
              ? crypto.randomUUID()
              : `queued-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
          text: messageContent,
          textElements: [],
          localImages: [],
          remoteImageUrls: [],
          mentionBindings: [],
          createdAt: Date.now(),
          projectName: selectedProject.name,
          projectPath: resolvedProjectPath,
          sessionMode: selectedSession?.mode || newSessionMode,
        });

        const queuedOutcome = reduceCodexInputSubmit(
          getSessionInputState(inputStateBySessionRef.current, sessionToActivate),
          queuedMessage,
          "queue",
        );
        inputStateBySessionRef.current = upsertSessionInputState(
          inputStateBySessionRef.current,
          sessionToActivate,
          queuedOutcome.state,
        );

        setInput("");
        inputValueRef.current = "";
        setPendingStageTagKeys([]);
        resetCommandMenuState();
        setAttachedPrompt(null);
        setAttachedFiles([]);
        setUploadingFiles(new Map());
        setFileErrors(new Map());
        setIsTextareaExpanded(false);
        setThinkingMode("none");
        if (draftStorageKey) {
          safeLocalStorage.removeItem(draftStorageKey);
        }
        if (textareaRef.current) {
          textareaRef.current.style.height = "auto";
        }
        return;
      }

      if (useSteerForThisSubmit && !activeTurnIdForSubmit) {
        setChatMessages((previous) => [
          ...previous,
          {
            type: "error",
            content:
              "Unable to send steer: no active turn is available for this session.",
            timestamp: new Date(),
          },
        ]);
        return;
      }

      let uploadedImages: ChatImage[] = [];
      let codexAttachmentPayload:
        | {
            imagePaths: string[];
            documentPaths: string[];
          }
        | undefined;
      let messageAttachments: ChatAttachment[] = [];

      if (currentAttachedFiles.length > 0) {
        let uploadedFiles: UploadedProjectFile[] = [];

        try {
          uploadedFiles = await uploadFilesToProject(currentAttachedFiles);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown error";
          console.error("File upload failed:", error);
          setChatMessages((previous) => [
            ...previous,
            {
              type: "error",
              content: `Failed to upload files: ${message}`,
              timestamp: new Date(),
            },
          ]);
          return;
        }

        messageAttachments = currentAttachedFiles.map((file, index) => {
          const uploadedFile = uploadedFiles[index];
          const uploadedPath =
            uploadedFile?.path && typeof uploadedFile.path === "string"
              ? uploadedFile.path
              : undefined;

          return {
            name: file.name,
            kind: getAttachmentKind(file),
            mimeType: file.type || undefined,
            path: uploadedPath,
          };
        });

        if (uploadedFiles.length > 0) {
          const fileNote = `\n\n[Files available at the following paths]\n${uploadedFiles
            .map((file, index) => `${index + 1}. ${file.path}`)
            .join("\n")}`;
          messageContent = `${messageContent}${fileNote}`;
        }

        codexAttachmentPayload = uploadedFiles.reduce(
          (
            accumulator: {
              imagePaths: string[];
              documentPaths: string[];
            },
            uploadedFile: UploadedProjectFile,
            index: number,
          ) => {
            const sourceFile = currentAttachedFiles[index];
            const uploadedPath =
              uploadedFile?.path && typeof uploadedFile.path === "string"
                ? uploadedFile.path
                : null;

            if (!sourceFile || !uploadedPath) {
              return accumulator;
            }

            if (isImageAttachment(sourceFile)) {
              accumulator.imagePaths.push(uploadedPath);
            } else if (isPdfAttachment(sourceFile)) {
              accumulator.documentPaths.push(uploadedPath);
            }

            return accumulator;
          },
          {
            imagePaths: [] as string[],
            documentPaths: [] as string[],
          },
        );

        const imageFiles = currentAttachedFiles.filter((file) => isImageAttachment(file));
        if (imageFiles.length > 0) {
          try {
            uploadedImages = await uploadPreviewImages(imageFiles);
          } catch (error) {
            console.error("Image preview upload failed:", error);
          }
        }
      }

      const editedMessageId = pendingEditedMessageIdRef.current;
      const userMessageId = createChatMessageId();
      const userMessage: ChatMessage = {
        messageId: userMessageId,
        type: "user",
        content: normalizedInput,
        submittedContent: messageContent,
        images: uploadedImages.length > 0 ? uploadedImages : undefined,
        attachments:
          messageAttachments.length > 0 ? messageAttachments : undefined,
        timestamp: new Date(),
        ...(editedMessageId ? { editedFromMessageId: editedMessageId } : {}),
        ...(currentAttachedPrompt ? { attachedPrompt: currentAttachedPrompt } : {}),
      };

      setChatMessages((previous) => applyEditedMessageToHistory(previous, userMessage, editedMessageId));
      pendingEditedMessageIdRef.current = null;
      const turnStartTime = Date.now();
      setIsLoading(true);
      setCanAbortSession(true);
      setClaudeStatus({
        text: "Processing",
        tokens: 0,
        can_interrupt: true,
        startTime: turnStartTime,
      });

      setIsUserScrolledUp(false);
      setTimeout(() => scrollToBottom(), 100);

      if (
        typeof window !== "undefined" &&
        isNewSession &&
        selectedProject.name
      ) {
        const optimisticSessionCreatedDetail: OptimisticSessionCreatedDetail = {
          sessionId: sessionToActivate,
          projectName: selectedProject.name,
          provider: "codex",
          mode: newSessionMode,
          displayName: getOptimisticSessionDisplayName(normalizedInput),
          summary: getOptimisticSessionDisplayName(normalizedInput),
          createdAt: new Date().toISOString(),
        };
        window.dispatchEvent(
          new CustomEvent<OptimisticSessionCreatedDetail>(
            OPTIMISTIC_SESSION_CREATED_EVENT,
            {
              detail: optimisticSessionCreatedDetail,
            },
          ),
        );
      }

      if (!effectiveSessionId && !selectedSession?.id) {
        clearScopedPendingSessionId(selectedProject.name, "codex");
        pendingViewSessionRef.current = {
          sessionId: sessionToActivate,
          startedAt: Date.now(),
        };
      }
      persistScopedPendingSessionId(
        selectedProject.name,
        "codex",
        sessionToActivate,
      );
      const telemetryEnabled = isTelemetryEnabled();
      const clientTurnId = userMessageId;

      const startMessage = createCodexInputMessage({
        id: clientTurnId,
        clientTurnId,
        text: normalizedInput,
        textElements: [],
        localImages:
          codexAttachmentPayload?.imagePaths && codexAttachmentPayload.imagePaths.length > 0
            ? [...codexAttachmentPayload.imagePaths]
            : [],
        remoteImageUrls: [],
        mentionBindings: [],
        createdAt: Date.now(),
        projectName: selectedProject.name,
        projectPath: resolvedProjectPath,
        sessionMode: isNewSession ? newSessionMode : selectedSession?.mode || newSessionMode,
      });

      const submitMode = useSteerForThisSubmit ? "steer" : "start";
      const inputStateBeforeSubmit = getSessionInputState(
        inputStateBySessionRef.current,
        sessionToActivate,
      );
      const submitOutcome = reduceCodexInputSubmit(
        inputStateBeforeSubmit,
        startMessage,
        submitMode,
      );
      inputStateBySessionRef.current = upsertSessionInputState(
        inputStateBySessionRef.current,
        sessionToActivate,
        submitOutcome.state,
      );

      const expectedTurnIdForSteer =
        activeTurnIdForSubmit || inputStateBeforeSubmit.activeTurnId || undefined;

      if (submitMode === "steer" && !expectedTurnIdForSteer) {
        withSessionInputState(sessionToActivate, (previous) =>
          reduceCodexSteerRejected(previous, {
            clientTurnId,
            turnKind: "steer",
            rejectedAt: Date.now(),
          }, startMessage),
        );
        setChatMessages((previous) => [
          ...previous,
          {
            type: "error",
            content:
              "Unable to send steer: no active turn is available for this session.",
            timestamp: new Date(),
          },
        ]);
      } else {
        dispatchCodexInputMessage(startMessage, sessionToActivate, {
          asSteer: submitMode === "steer",
          expectedTurnId: expectedTurnIdForSteer,
          appendLocalUserMessage: true,
          isCurrentViewSession,
          includeSessionModeContext: Boolean(isNewSession),
          codexCommandText: messageContent,
          model: codexModel,
          permissionModeOverride: permissionMode,
          modelReasoningEffort:
            codexReasoningEffort === "default"
              ? undefined
              : codexReasoningEffort,
          telemetryEnabled,
          attachments: codexAttachmentPayload,
          images: uploadedImages,
          stageTagKeys: currentStageTagKeys,
          stageTagSource: "task_context",
          provisionalSessionId: isNewSession ? sessionToActivate : undefined,
          resumeSessionId: effectiveSessionId || undefined,
          resume: Boolean(effectiveSessionId),
        });
      }

      setInput("");
      inputValueRef.current = "";
      setPendingStageTagKeys([]);
      pendingStageTagKeysRef.current = [];
      resetCommandMenuState();
      setAttachedFiles([]);
      attachedFilesRef.current = [];
      setUploadingFiles(new Map());
      setFileErrors(new Map());
      setIsTextareaExpanded(false);
      setThinkingMode("none");
      setAttachedPrompt(null);
      attachedPromptRef.current = null;
      pendingEditedMessageIdRef.current = null;

      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }

      if (draftStorageKey) {
        safeLocalStorage.removeItem(draftStorageKey);
      }
    },
    [
      attachedFiles,
      attachedPrompt,
      codexModel,
      codexReasoningEffort,
      currentSessionId,
      executeCommand,
      intakeGreeting,
      isLoading,
      newSessionMode,
      pendingViewSessionRef,
      permissionMode,
      provider,
      resetCommandMenuState,
      resolveSessionContext,
      scrollToBottom,
      selectedProject,
      selectedSession?.id,
      selectedSession?.mode,
      setChatMessages,
      slashCommands,
      t,
      thinkingMode,
      uploadFilesToProject,
      uploadPreviewImages,
    ],
  );

  const handleQueueSubmit = useCallback(
    (event: MouseEvent<HTMLButtonElement> | TouchEvent<HTMLButtonElement>) => {
      void handleSubmit(event, { intent: "queue" });
    },
    [handleSubmit],
  );

  useEffect(() => {
    handleSubmitRef.current = handleSubmit;
  }, [handleSubmit]);

  useEffect(() => {
    inputValueRef.current = input;
  }, [input]);

  useEffect(() => {
    if (!selectedProject || !draftStorageKey) {
      return;
    }
    const savedInput = safeLocalStorage.getItem(draftStorageKey) || "";
    setInput((previous) => {
      const next = previous === savedInput ? previous : savedInput;
      inputValueRef.current = next;
      return next;
    });
  }, [draftStorageKey, selectedProject]);

  useEffect(() => {
    if (!selectedProject) {
      return;
    }

    const applyDraft = (draft: string) => {
      setInput(draft);
      inputValueRef.current = draft;
      syncTextareaLayout(draft, true);
    };

    const applyQueuedDraft = () => {
      const wqDraft = consumeWorkspaceQaDraft(selectedProject.name);
      if (wqDraft) {
        applyDraft(wqDraft);
        return;
      }
      const refDraft = consumeReferenceChatDraft(selectedProject.name);
      if (refDraft) {
        applyDraft(refDraft.text);

        if (refDraft.pdfCached && refDraft.referenceId) {
          (async () => {
            try {
              const res = await authenticatedFetch(
                `/api/references/${refDraft.referenceId}/pdf`,
              );
              if (res.ok) {
                const blob = await res.blob();
                const file = new File([blob], `${refDraft.referenceId}.pdf`, {
                  type: "application/pdf",
                });
                setAttachedFiles((prev: File[]) => [...prev, file].slice(0, 5));
              }
            } catch {
              // PDF fetch failed 閳?user still has text context
            }
          })();
        }
      }
    };

    applyQueuedDraft();

    const handleQueuedDraft = (event: Event) => {
      const customEvent = event as CustomEvent<{ projectName?: string }>;
      if (customEvent.detail?.projectName !== selectedProject.name) {
        return;
      }
      applyQueuedDraft();
    };

    window.addEventListener(WORKSPACE_QA_DRAFT_EVENT, handleQueuedDraft);
    window.addEventListener(REFERENCE_CHAT_DRAFT_EVENT, handleQueuedDraft);
    return () => {
      window.removeEventListener(WORKSPACE_QA_DRAFT_EVENT, handleQueuedDraft);
      window.removeEventListener(REFERENCE_CHAT_DRAFT_EVENT, handleQueuedDraft);
    };
  }, [selectedProject?.name, setInput]);

  useEffect(() => {
    if (!selectedProject || !draftStorageKey) {
      return;
    }
    if (input !== "") {
      safeLocalStorage.setItem(draftStorageKey, input);
    } else {
      safeLocalStorage.removeItem(draftStorageKey);
    }
  }, [draftStorageKey, input, selectedProject]);

  useEffect(() => {
    if (!textareaRef.current) {
      return;
    }
    // Re-run when input changes so restored drafts get the same autosize behavior as typed text.
    textareaRef.current.style.height = "auto";
    textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    const computedStyle = window.getComputedStyle(textareaRef.current);
    const lineHeight = resolveLineHeightPx(computedStyle.lineHeight, computedStyle.fontSize);
    const expanded = textareaRef.current.scrollHeight > lineHeight * 2;
    setIsTextareaExpanded(expanded);
  }, [input]);

  useEffect(() => {
    if (!textareaRef.current || input.trim()) {
      return;
    }
    textareaRef.current.style.height = "auto";
    setIsTextareaExpanded(false);
  }, [input]);

  const handleInputChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = event.target.value;
      const cursorPos = event.target.selectionStart;

      setInput(newValue);
      inputValueRef.current = newValue;
      setCursorPosition(cursorPos);

      if (!newValue.trim()) {
        setPendingStageTagKeys([]);
        event.target.style.height = "auto";
        setIsTextareaExpanded(false);
        resetCommandMenuState();
        return;
      }

      handleCommandInputChange(newValue, cursorPos);
    },
    [handleCommandInputChange, resetCommandMenuState, setCursorPosition],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (handleCommandMenuKeyDown(event)) {
        return;
      }

      if (handleFileMentionsKeyDown(event)) {
        return;
      }

      if (event.key === "Tab" && !showFileDropdown && !showCommandMenu) {
        event.preventDefault();
        cyclePermissionMode();
        return;
      }

      if (event.key === "Enter") {
        if (event.nativeEvent.isComposing) {
          return;
        }

        if ((event.ctrlKey || event.metaKey) && !event.shiftKey) {
          event.preventDefault();
          handleSubmit(event);
        } else if (
          !event.shiftKey &&
          !event.ctrlKey &&
          !event.metaKey &&
          !sendByCtrlEnter
        ) {
          event.preventDefault();
          handleSubmit(event);
        }
      }
    },
    [
      cyclePermissionMode,
      handleCommandMenuKeyDown,
      handleFileMentionsKeyDown,
      handleSubmit,
      provider,
      sendByCtrlEnter,
      showCommandMenu,
      showFileDropdown,
    ],
  );

  const handleTextareaClick = useCallback(
    (event: MouseEvent<HTMLTextAreaElement>) => {
      setCursorPosition(event.currentTarget.selectionStart);
    },
    [setCursorPosition],
  );

  const handleTextareaInput = useCallback(
    (event: FormEvent<HTMLTextAreaElement>) => {
      const target = event.currentTarget;
      target.style.height = "auto";
      target.style.height = `${target.scrollHeight}px`;
      setCursorPosition(target.selectionStart);
      syncInputOverlayScroll(target);

      const computedStyle = window.getComputedStyle(target);
      const lineHeight = resolveLineHeightPx(computedStyle.lineHeight, computedStyle.fontSize);
      setIsTextareaExpanded(target.scrollHeight > lineHeight * 2);
    },
    [setCursorPosition, syncInputOverlayScroll],
  );

  const handleClearInput = useCallback(() => {
    setInput("");
    inputValueRef.current = "";
    setPendingStageTagKeys([]);
    pendingStageTagKeysRef.current = [];
    setAttachedFiles([]);
    attachedFilesRef.current = [];
    setUploadingFiles(new Map());
    setFileErrors(new Map());
    setAttachedPrompt(null);
    attachedPromptRef.current = null;
    pendingEditedMessageIdRef.current = null;
    resetCommandMenuState();
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.focus();
    }
    setIsTextareaExpanded(false);
  }, [resetCommandMenuState]);

  const handleAbortSession = useCallback(() => {
    if (!canAbortSession) {
      // Force-reset the UI when Stop is clicked but no active abort is possible.
      // This handles stale state after server restarts or lost WebSocket connections.
      if (isLoading) {
        setIsLoading(false);
        setCanAbortSession(false);
        setClaudeStatus(null);
        setPendingPermissionRequests([]);
        const sessionId = currentSessionId || selectedSession?.id;
        if (sessionId) clearSessionTimerStart(sessionId);
      }
      return;
    }

    setCanAbortSession(false);

    const pendingSessionId = readScopedPendingSessionId(
      currentProjectName,
      "codex",
    );

    const candidateSessionIds = [
      currentSessionId,
      pendingViewSessionRef.current?.sessionId || null,
      pendingSessionId,
      selectedSession?.id || null,
    ];

    const targetSessionId =
      candidateSessionIds.find(
        (sessionId) => Boolean(sessionId) && !isTemporarySessionId(sessionId),
      ) || null;

    if (!targetSessionId) {
      const recoverySessionIds = Array.from(
        new Set(
          candidateSessionIds.filter(
            (sessionId): sessionId is string => Boolean(sessionId),
          ),
        ),
      );

      for (const sessionId of recoverySessionIds) {
        clearSessionTimerStart(sessionId);
      }

      setIsLoading(false);
      setCanAbortSession(false);
      setClaudeStatus(null);
      setPendingPermissionRequests([]);
      return;
    }

    sendMessage({
      type: "abort-session",
      sessionId: targetSessionId,
      provider: "codex",
    });
    const targetState = getSessionInputState(inputStateBySessionRef.current, targetSessionId);
    if (targetState.pendingSteers.length > 0) {
      inputStateBySessionRef.current = upsertSessionInputState(
        inputStateBySessionRef.current,
        targetSessionId,
        {
          ...targetState,
          interruptRequestedForPendingSteers: true,
        },
      );
    }


  }, [
    canAbortSession,
    currentProjectName,
    currentSessionId,
    isLoading,
    pendingViewSessionRef,
    selectedSession?.id,
    sendMessage,
    setCanAbortSession,
    setClaudeStatus,
    setIsLoading,
    setPendingPermissionRequests,
  ]);

  const handleTranscript = useCallback((text: string) => {
    if (!text.trim()) {
      return;
    }

    setInput((previousInput) => {
      const newInput = previousInput.trim() ? `${previousInput} ${text}` : text;
      inputValueRef.current = newInput;
      syncTextareaLayout(newInput, false);

      return newInput;
    });
  }, [syncTextareaLayout]);

  const handleGrantToolPermission = useCallback(
    (suggestion: { entry: string; toolName: string }) => {
      if (!suggestion) {
        return { success: false };
      }
      return grantToolPermission(suggestion.entry, "codex");
    },
    [],
  );

  const handlePermissionDecision = useCallback(
    (
      requestIds: string | string[],
      decision: {
        allow?: boolean;
        message?: string;
        rememberEntry?: string | null;
        updatedInput?: unknown;
      },
    ) => {
      const ids = Array.isArray(requestIds) ? requestIds : [requestIds];
      const validIds = ids.filter(Boolean);
      if (validIds.length === 0) {
        return;
      }

      validIds.forEach((requestId) => {
        sendMessage({
          type: "codex-permission-response",
          requestId,
          allow: Boolean(decision?.allow),
          updatedInput: decision?.updatedInput,
          message: decision?.message,
          rememberEntry: decision?.rememberEntry,
        });
      });

      // Update the local chatMessage toolInput so answered questions render with selections
      if (
        decision?.updatedInput &&
        typeof decision.updatedInput === "object" &&
        "answers" in (decision.updatedInput as Record<string, unknown>)
      ) {
        const updated = decision.updatedInput as Record<string, unknown>;
        setChatMessages((previous) => {
          const msgs = [...previous];
          for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].toolName === "AskUserQuestion" && msgs[i].isToolUse) {
              msgs[i] = { ...msgs[i], toolInput: updated };
              break;
            }
          }
          return msgs;
        });
      }

      setPendingPermissionRequests((previous) => {
        const next = previous.filter(
          (request) => !validIds.includes(request.requestId),
        );
        if (next.length === 0) {
          setClaudeStatus(null);
        }
        return next;
      });
    },
    [
      setChatMessages,
      setPendingPermissionRequests,
    ],
  );

  const [isInputFocused, setIsInputFocused] = useState(false);

  const handleInputFocusChange = useCallback(
    (focused: boolean) => {
      setIsInputFocused(focused);
      onInputFocusChange?.(focused);
    },
    [onInputFocusChange],
  );

  return {
    input,
    setInput,
    attachedPrompt,
    setAttachedPrompt,
    textareaRef,
    inputHighlightRef,
    isTextareaExpanded,
    thinkingMode,
    setThinkingMode,
    codexReasoningEffort,
    setCodexReasoningEffort,
    slashCommandsCount,
    filteredCommands,
    frequentCommands,
    commandQuery,
    showCommandMenu,
    selectedCommandIndex,
    resetCommandMenuState,
    handleCommandSelect,
    handleToggleCommandMenu,
    showFileDropdown,
    filteredFiles: filteredFiles as MentionableFile[],
    selectedFileIndex,
    renderInputWithMentions,
    selectFile,
    attachedFiles,
    removeAttachedFile,
    uploadingFiles,
    fileErrors,
    getRootProps,
    getInputProps,
    isDragActive,
    openFilePicker: open,
    handleSubmit,
    handleQueueSubmit,
    handleInputChange,
    handleKeyDown,
    handlePaste,
    handleTextareaClick,
    handleTextareaInput,
    syncInputOverlayScroll,
    handleClearInput,
    handleAbortSession,
    handleTranscript,
    handlePermissionDecision,
    handleGrantToolPermission,
    handleInputFocusChange,
    isInputFocused,
    intakeGreeting,
    setIntakeGreeting,
    btwOverlay,
    closeBtwOverlay,
    setPendingStageTagKeys,
    submitProgrammaticInput,
    submitProgrammaticMessage,
    loadMessageIntoComposer,
    activeQueueSessionId,
    rejectedSteersPreview,
    pendingSteersPreview,
    queuedFollowupPreview,
    restoreLastQueuedToComposer,
    handleCodexTurnStarted,
    handleCodexTurnSettled,
    handleCodexSessionIdResolved,
    handleCodexSessionStatusUpdate,
    handleCodexSteerCommitted,
    handleCodexSteerRejected,
  };
}
