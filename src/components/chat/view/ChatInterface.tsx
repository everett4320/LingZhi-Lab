import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QuickSettingsPanel from '../../QuickSettingsPanel';
import CodeEditor from '../../CodeEditor';
import ChatTaskProgressPill from './subcomponents/ChatTaskProgressPill';
import { useTasksSettings } from '../../../contexts/TasksSettingsContext';
import { useTaskMaster } from '../../../contexts/TaskMasterContext';
import { useTranslation } from 'react-i18next';
import ChatMessagesPane from './subcomponents/ChatMessagesPane';
import ChatComposer from './subcomponents/ChatComposer';
import BtwOverlay from './subcomponents/BtwOverlay';
import ChatContextSidebar from './subcomponents/ChatContextSidebar';
import GuidedPromptStarter from './subcomponents/GuidedPromptStarter';
import { RESUMING_STATUS_TEXT } from '../types/types';
import type { ChatInterfaceProps } from '../types/types';
import type { ProviderAvailability } from '../types/types';
import type { ChatMessage } from '../types/types';
import { useChatProviderState } from '../hooks/useChatProviderState';
import { useChatSessionState } from '../hooks/useChatSessionState';
import { useChatRealtimeHandlers } from '../hooks/useChatRealtimeHandlers';
import { useChatComposerState } from '../hooks/useChatComposerState';
import type { Provider } from '../types/types';
import { authenticatedFetch } from '../../../utils/api';
import { readCliAvailability, writeCliAvailability } from '../../../utils/cliAvailability';
import { Button } from '../../ui/button';
import type { PendingAutoIntake } from '../../../types/app';
import type { EditingFile, DiffInfo } from '../../main-content/types/types';
import { CODEX_MODELS } from '../../../../shared/modelConstants';
import { getProviderDisplayName } from '../utils/chatFormatting';
import { buildEditableMessageDraft, buildReplayMessageDraft, getChatMessageId, getMessageReplayContent } from '../utils/chatMessages';
import { normalizePath, toRelativePath, isSafePath, fileNameFromPath } from '../../../utils/pathUtils';
import { useDeviceSettings } from '../../../hooks/useDeviceSettings';

const DEFAULT_PROVIDER_AVAILABILITY: Record<Provider, ProviderAvailability> = {
  codex: { cliAvailable: true, cliCommand: 'codex', installHint: null },
};

const INTAKE_GREETING = `Hello! I'm your Lingzhi Lab research assistant, here to help you set up your research pipeline.\n\nTo get started, could you tell me about your research field or topic?`;

const getAutoIntakePrompt = (pendingAutoIntake?: PendingAutoIntake | null) => {
  const prompt = pendingAutoIntake?.prompt?.trim();
  return prompt || null;
};

const getAutoIntakeTriggerId = (pendingAutoIntake?: PendingAutoIntake | null) => {
  const triggerId = pendingAutoIntake?.triggerId?.trim();
  return triggerId || null;
};

const getAutoIntakeStorageKey = (projectName: string, triggerId?: string | null) =>
  triggerId ? `intake_triggered_${projectName}_${triggerId}` : `intake_triggered_${projectName}`;

const getImportedProjectAnalysisStorageKey = (projectName: string) => `imported_project_analysis_prompt_${projectName}`;

type PendingViewSession = {
  sessionId: string | null;
  startedAt: number;
};

type SidebarTab = 'context' | 'research' | 'files' | 'shell' | 'git';

function ChatInterface({
  selectedProject,
  selectedSession,
  ws,
  sendMessage,
  latestMessage,
  onInputFocusChange,
  onSessionActive,
  onSessionInactive,
  onSessionProcessing,
  onSessionNotProcessing,
  processingSessions,
  onReplaceTemporarySession,
  onNavigateToSession,
  onShowSettings,
  autoExpandTools,
  showRawParameters,
  showThinking,
  autoScrollToBottom,
  sendByCtrlEnter,
  externalMessageUpdate,
  onStartWorkspaceQa,
  pendingAutoIntake,
  clearPendingAutoIntake,
  importedProjectAnalysisPrompt,
  clearImportedProjectAnalysisPrompt,
  newSessionMode = 'research',
  onNewSessionModeChange,
}: ChatInterfaceProps) {
  const { tasksEnabled, isTaskMasterInstalled } = useTasksSettings();
  const { refreshTasks } = useTaskMaster();
  const { t } = useTranslation('chat');
  const { isMobile } = useDeviceSettings({ trackPWA: false });
  const [isShellEditPromptOpen, setIsShellEditPromptOpen] = useState(false);
  const [editingFile, setEditingFile] = useState<EditingFile | null>(null);

  const handleFileOpen = useCallback((filePath: string, diffInfo?: unknown) => {
    const root = selectedProject?.fullPath || selectedProject?.path || '';
    const relative = toRelativePath(filePath, root);
    if (!relative || !isSafePath(relative)) return;
    const name = fileNameFromPath(normalizePath(filePath));
    setEditingFile({
      name,
      path: relative,
      projectName: selectedProject?.name,
      diffInfo: (diffInfo ?? null) as DiffInfo | null,
    });
  }, [selectedProject]);

  const handleCloseEditor = useCallback(() => {
    setEditingFile(null);
  }, []);

  const [sidebarTab, setSidebarTab] = useState<SidebarTab>(() => {
    if (typeof window === 'undefined') return 'context';
    const stored = window.localStorage.getItem('chat-sidebar-active-tab');
    if (stored === 'research' || stored === 'files' || stored === 'shell' || stored === 'git') return stored;
    return 'context';
  });
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('chat-session-context-collapsed') === '1';
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('chat-sidebar-active-tab', sidebarTab);
    }
  }, [sidebarTab]);

  const streamBufferRef = useRef('');
  const streamTimerRef = useRef<number | null>(null);
  const pendingViewSessionRef = useRef<PendingViewSession | null>(null);

  const resetStreamingState = useCallback(() => {
    if (streamTimerRef.current) {
      clearTimeout(streamTimerRef.current);
      streamTimerRef.current = null;
    }
    streamBufferRef.current = '';
  }, []);

  const {
    provider,
    setProvider,
    codexModel,
    setCodexModel,
    permissionMode,
    pendingPermissionRequests,
    setPendingPermissionRequests,
    cyclePermissionMode,
  } = useChatProviderState({
    selectedSession,
  });

  const {
    chatMessages,
    setChatMessages,
    isLoading,
    setIsLoading,
    currentSessionId,
    setCurrentSessionId,
    sessionMessages,
    setSessionMessages,
    isLoadingSessionMessages,
    isLoadingMoreMessages,
    hasMoreMessages,
    totalMessages,
    isSystemSessionChange,
    setIsSystemSessionChange,
    canAbortSession,
    setCanAbortSession,
    isUserScrolledUp,
    setIsUserScrolledUp,
    tokenBudget,
    setTokenBudget,
    visibleMessageCount,
    visibleMessages,
    loadEarlierMessages,
    loadAllMessages,
    allMessagesLoaded,
    isLoadingAllMessages,
    loadAllJustFinished,
    showLoadAllOverlay,
    claudeStatus,
    setClaudeStatus,
    statusTextOverride,
    setStatusTextOverride,
    createDiff,
    scrollContainerRef,
    scrollToBottom,
    scrollToBottomAndReset,
    handleScroll,
    resolveSessionStatusCheck,
  } = useChatSessionState({
    selectedProject,
    selectedSession,
    activeProvider: provider,
    ws,
    sendMessage,
    autoScrollToBottom,
    externalMessageUpdate,
    processingSessions,
    resetStreamingState,
    pendingViewSessionRef,
  });

  const chatMessagesForBtwRef = useRef(chatMessages);
  chatMessagesForBtwRef.current = chatMessages;
  const getChatMessagesForBtw = useCallback(() => chatMessagesForBtwRef.current, []);

  const {
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
    filteredFiles,
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
    openFilePicker,
    handleSubmit,
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
    setPendingStageTagKeys,
    submitProgrammaticInput,
    btwOverlay,
    closeBtwOverlay,
    submitProgrammaticMessage,
    loadMessageIntoComposer,
  } = useChatComposerState({
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
    onInputFocusChange,
    onFileOpen: handleFileOpen,
    onShowSettings,
    pendingViewSessionRef,
    scrollToBottom,
    setChatMessages,
    setSessionMessages,
    setIsLoading,
    setCanAbortSession,
    setClaudeStatus,
    setIsUserScrolledUp,
    setPendingPermissionRequests,
    newSessionMode,
    getChatMessagesForBtw,
  });

  useChatRealtimeHandlers({
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
    onSessionStatusResolved: resolveSessionStatusCheck,
    onReplaceTemporarySession,
    onNavigateToSession,
    sendMessage,
  });

  const handleRetry = useCallback(() => {
    const msgs = chatMessagesForBtwRef.current;
    let lastUserMessage: ChatMessage | undefined;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].type === 'user') { lastUserMessage = msgs[i]; break; }
    }
    if (!lastUserMessage) return;
    const replayDraft = buildReplayMessageDraft(lastUserMessage);
    if (!replayDraft) return;
    submitProgrammaticMessage(replayDraft);
  }, [submitProgrammaticMessage]);

  const handleCopyMessage = useCallback(async (message: ChatMessage) => {
    const text = getMessageReplayContent(message).trim();
    if (!text || typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      return false;
    }

    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      console.error('Failed to copy message text:', error);
      return false;
    }
  }, []);

  const handleResendMessage = useCallback((message: ChatMessage) => {
    const replayDraft = buildReplayMessageDraft(message);
    if (!replayDraft) {
      return;
    }

    submitProgrammaticMessage(replayDraft);
  }, [submitProgrammaticMessage]);

  const handleEditMessage = useCallback((message: ChatMessage) => {
    const editableDraft = buildEditableMessageDraft(message);
    if (!editableDraft) {
      return;
    }

    const didLoad = loadMessageIntoComposer({
      ...editableDraft,
      editingMessageId: getChatMessageId(message),
    });
    if (didLoad) {
      scrollToBottomAndReset();
    }
  }, [loadMessageIntoComposer, scrollToBottomAndReset]);

  const autoIntakeTriggeredRef = useRef(false);
  const lastAutoIntakeTriggerIdRef = useRef<string | null>(null);
  const shouldShowImportedProjectAnalysisPrompt = useMemo(() => {
    if (!importedProjectAnalysisPrompt || !selectedProject || selectedSession || isLoading) {
      return false;
    }

    const targetProjectName = importedProjectAnalysisPrompt.project?.name;
    if (!targetProjectName || targetProjectName !== selectedProject.name) {
      return false;
    }

    if (chatMessages.length > 0) {
      return false;
    }

    if (typeof window === 'undefined') {
      return true;
    }

    const dismissedKey = getImportedProjectAnalysisStorageKey(selectedProject.name);
    return sessionStorage.getItem(dismissedKey) !== 'dismissed';
  }, [chatMessages.length, importedProjectAnalysisPrompt, isLoading, selectedProject, selectedSession]);
  const [providerAvailability, setProviderAvailability] = React.useState<Record<Provider, ProviderAvailability>>(() => {
    const cached = readCliAvailability();

    return {
      codex: cached.codex ?? DEFAULT_PROVIDER_AVAILABILITY.codex,
    };
  });

  const importedProjectAnalysisModel = useMemo(() => codexModel, [codexModel]);

  const handleStartTaskInChat = useCallback((prompt?: string, task?: { stage?: string } | null) => {
    const nextPrompt = prompt && prompt.trim()
      ? prompt
      : t('tasks.nextTaskPrompt', { defaultValue: 'Start the next task' });
    setInput(nextPrompt);
    const stage = String(task?.stage || '').trim().toLowerCase();
    setPendingStageTagKeys(stage ? [stage] : []);
  }, [setInput, setPendingStageTagKeys, t]);

  useEffect(() => {
    let cancelled = false;

    const loadProviderAvailability = async () => {
      const checks: Array<{ provider: Provider; endpoint: string; fallbackCommand: string }> = [
        { provider: 'codex', endpoint: '/api/cli/codex/status', fallbackCommand: 'codex' },
      ];

      const results = await Promise.all(checks.map(async ({ provider: nextProvider, endpoint, fallbackCommand }) => {
        try {
          const response = await authenticatedFetch(endpoint);
          const data = await response.json();
          return [nextProvider, {
            cliAvailable: data.cliAvailable !== false,
            cliCommand: data.cliCommand || fallbackCommand,
            installHint: data.installHint || null,
          }] as const;
        } catch {
          return [nextProvider, {
            cliAvailable: true,
            cliCommand: fallbackCommand,
            installHint: null,
          }] as const;
        }
      }));

      if (cancelled) {
        return;
      }

      const nextAvailability = Object.fromEntries(results) as Record<Provider, ProviderAvailability>;
      for (const [nextProvider, availability] of Object.entries(nextAvailability) as Array<[Provider, ProviderAvailability]>) {
        writeCliAvailability(nextProvider, {
          cliAvailable: availability.cliAvailable,
          cliCommand: availability.cliCommand ?? null,
          installHint: availability.installHint ?? null,
        });
      }

      setProviderAvailability(nextAvailability);
    };

    void loadProviderAvailability();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (providerAvailability[provider]?.cliAvailable === false) {
      const fallbackProvider = (['codex'] as const).find(
        (candidate) => providerAvailability[candidate]?.cliAvailable !== false,
      );

      if (fallbackProvider && fallbackProvider !== provider) {
        setProvider(fallbackProvider);
        localStorage.setItem('selected-provider', fallbackProvider);
      }
    }
  }, [provider, providerAvailability, setProvider]);

  useEffect(() => {
    const triggerId = getAutoIntakeTriggerId(pendingAutoIntake);
    if (triggerId && lastAutoIntakeTriggerIdRef.current !== triggerId) {
      autoIntakeTriggeredRef.current = false;
      lastAutoIntakeTriggerIdRef.current = triggerId;
    }

    if (!pendingAutoIntake || newSessionMode !== 'research') {
      autoIntakeTriggeredRef.current = false;
      return;
    }

    if (
      autoIntakeTriggeredRef.current ||
      !selectedProject ||
      selectedSession ||
      isLoading ||
      chatMessages.length > 0
    ) return;

    const intakeKey = getAutoIntakeStorageKey(selectedProject.name, triggerId);
    if (sessionStorage.getItem(intakeKey)) {
      clearPendingAutoIntake?.();
      return;
    }

    autoIntakeTriggeredRef.current = true;
    sessionStorage.setItem(intakeKey, 'true');

    const autoIntakePrompt = getAutoIntakePrompt(pendingAutoIntake);

    if (autoIntakePrompt) {
      clearPendingAutoIntake?.();
      submitProgrammaticInput(autoIntakePrompt);
      return;
    }

    clearPendingAutoIntake?.();

    setIntakeGreeting(INTAKE_GREETING);
  }, [
    pendingAutoIntake,
    selectedProject,
    selectedSession,
    isLoading,
    chatMessages.length,
    clearPendingAutoIntake,
    setIntakeGreeting,
    submitProgrammaticInput,
    newSessionMode,
  ]);

  useEffect(() => {
    if (selectedSession?.mode) {
      onNewSessionModeChange?.(selectedSession.mode);
    }
  }, [onNewSessionModeChange, selectedSession?.id, selectedSession?.mode]);

  useEffect(() => {
    setIsShellEditPromptOpen(false);
  }, [selectedProject?.name, selectedSession?.id]);

  useEffect(() => {
    setEditingFile(null);
  }, [selectedSession?.id, selectedProject?.name]);

  useEffect(() => {
    if (!editingFile) {
      return undefined;
    }

    const handlePreviewEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat || event.defaultPrevented) {
        return;
      }

      event.stopPropagation();
      setEditingFile(null);
    };

    document.addEventListener('keydown', handlePreviewEscape);
    return () => document.removeEventListener('keydown', handlePreviewEscape);
  }, [editingFile]);

  useEffect(() => {
    if (!isLoading || !canAbortSession) {
      return;
    }

    const handleGlobalEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat || event.defaultPrevented) {
        return;
      }

      event.preventDefault();
      handleAbortSession();
    };

    document.addEventListener('keydown', handleGlobalEscape, { capture: true });
    return () => {
      document.removeEventListener('keydown', handleGlobalEscape, { capture: true });
    };
  }, [canAbortSession, handleAbortSession, isLoading]);

  const prevIsLoadingForProcessingRef = useRef(false);
  useEffect(() => {
    const processingSessionId = selectedSession?.id || currentSessionId;
    const shouldTrackAsProcessing = isLoading && claudeStatus?.text !== RESUMING_STATUS_TEXT;
    const loadingJustStarted = shouldTrackAsProcessing && !prevIsLoadingForProcessingRef.current;
    prevIsLoadingForProcessingRef.current = shouldTrackAsProcessing;
    if (processingSessionId && loadingJustStarted && onSessionProcessing) {
      onSessionProcessing(processingSessionId);
    }
  }, [claudeStatus?.text, currentSessionId, isLoading, onSessionProcessing, selectedSession?.id]);

  useEffect(() => {
    return () => {
      resetStreamingState();
    };
  }, [resetStreamingState]);

  useEffect(() => {
    if (!latestMessage?.type) {
      return;
    }

    if (latestMessage.type === 'chat-turn-complete') {
      refreshTasks?.();
    }
  }, [latestMessage, refreshTasks]);

  const handleImportedProjectAnalysisDismiss = useCallback(() => {
    if (typeof window !== 'undefined' && selectedProject) {
      sessionStorage.setItem(getImportedProjectAnalysisStorageKey(selectedProject.name), 'dismissed');
    }
    clearImportedProjectAnalysisPrompt?.();
  }, [clearImportedProjectAnalysisPrompt, selectedProject]);

  const handleImportedProjectAnalysisModelChange = useCallback((nextModel: string) => {
    setCodexModel(nextModel);
    localStorage.setItem('codex-model', nextModel);
  }, [setCodexModel]);

  const handleImportedProjectAnalysisConfirm = useCallback(() => {
    const prompt = importedProjectAnalysisPrompt?.prompt?.trim();
    if (!prompt || !selectedProject) {
      clearImportedProjectAnalysisPrompt?.();
      return;
    }

    if (typeof window !== 'undefined') {
      sessionStorage.removeItem(getImportedProjectAnalysisStorageKey(selectedProject.name));
    }

    setProvider('codex');
    localStorage.setItem('selected-provider', 'codex');

    clearImportedProjectAnalysisPrompt?.();
    submitProgrammaticInput(prompt);
  }, [
    clearImportedProjectAnalysisPrompt,
    importedProjectAnalysisPrompt?.prompt,
    selectedProject,
    setProvider,
    submitProgrammaticInput,
  ]);

  const handleOpenShellEditPrompt = useCallback(() => {
    if (!selectedSession) {
      return;
    }
    setIsShellEditPromptOpen(true);
  }, [selectedSession]);

  const handleCloseShellEditPrompt = useCallback(() => {
    setIsShellEditPromptOpen(false);
  }, []);

  const handleConfirmOpenShell = useCallback(() => {
    setIsShellEditPromptOpen(false);
    setSidebarTab('shell');
    setIsSidebarCollapsed(false);
  }, []);

  const isEmpty = chatMessages.length === 0 && !isLoadingSessionMessages && !selectedSession && !currentSessionId;

  if (!selectedProject) {
    const selectedProviderLabel = getProviderDisplayName(provider);

    return (
      <>
        <div className="flex items-center justify-center h-full">
          <div className="text-center text-muted-foreground">
            <p className="text-sm">
              {t('projectSelection.startChatWithProvider', {
                provider: selectedProviderLabel,
                defaultValue: 'Select a project to start chatting with {{provider}}',
              })}
            </p>
          </div>
        </div>
        <div className="flex justify-end px-4 pb-4">
          <ChatTaskProgressPill
            onStartTask={handleStartTaskInChat}
            onShowAllTasks={() => setSidebarTab('research')}
          />
        </div>
      </>
    );
  }

  return (
    <>
      <div className={`h-full flex min-h-0 ${isMobile ? 'flex-col' : 'flex-row'}`}>
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <div className={`flex min-h-0 flex-1 flex-col ${isEmpty ? 'justify-start pt-[18vh] overflow-y-auto' : ''}`}>
        {shouldShowImportedProjectAnalysisPrompt && (
          <div className="mx-auto mt-4 w-full max-w-3xl px-3 sm:px-4">
            <div className="rounded-xl border border-border bg-card/95 shadow-sm px-4 py-4 sm:px-5">
              <div className="flex flex-col gap-4">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Analyze Imported Project?</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Start a new session to scan this workspace, analyze the project structure and implementation, and summarize next steps.
                  </p>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div className="grid gap-3 sm:grid-cols-1 sm:gap-4">
                    <label className="flex flex-col gap-1.5">
                      <span className="text-xs font-medium text-muted-foreground">Model</span>
                      <select
                        value={importedProjectAnalysisModel}
                        onChange={(event) => handleImportedProjectAnalysisModelChange(event.target.value)}
                        className="min-w-[220px] rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                      >
                        {CODEX_MODELS.OPTIONS.map(({ value, label }: { value: string; label: string }) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="flex gap-2 sm:flex-shrink-0">
                    <Button variant="outline" onClick={handleImportedProjectAnalysisDismiss}>
                      Not Now
                    </Button>
                    <Button onClick={handleImportedProjectAnalysisConfirm}>
                      Analyze Project
                    </Button>
                  </div>
                </div>

                {providerAvailability.codex?.cliAvailable === false && (
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    {providerAvailability.codex?.installHint || 'Codex CLI is not installed.'}
                  </p>
                )}

              </div>
            </div>
          </div>
        )}

        <ChatMessagesPane
          scrollContainerRef={scrollContainerRef}
          onWheel={handleScroll}
          onTouchMove={handleScroll}
          isLoadingSessionMessages={isLoadingSessionMessages}
          chatMessages={chatMessages}
          selectedSession={selectedSession}
          intakeGreeting={intakeGreeting}
          currentSessionId={currentSessionId}
          provider={provider}
          isLoadingMoreMessages={isLoadingMoreMessages}
          hasMoreMessages={hasMoreMessages}
          totalMessages={totalMessages}
          sessionMessagesCount={sessionMessages.length}
          visibleMessageCount={visibleMessageCount}
          visibleMessages={visibleMessages}
          loadEarlierMessages={loadEarlierMessages}
          loadAllMessages={loadAllMessages}
          allMessagesLoaded={allMessagesLoaded}
          isLoadingAllMessages={isLoadingAllMessages}
          loadAllJustFinished={loadAllJustFinished}
          showLoadAllOverlay={showLoadAllOverlay}
          createDiff={createDiff}
          onFileOpen={handleFileOpen}
          onShowSettings={onShowSettings}
          onGrantToolPermission={handleGrantToolPermission}
          autoExpandTools={autoExpandTools}
          showRawParameters={showRawParameters}
          showThinking={showThinking}
          selectedProject={selectedProject}
          isLoading={isLoading}
          statusText={statusTextOverride || claudeStatus?.text}
          newSessionMode={newSessionMode}
          onRetry={handleRetry}
          onCopyMessage={handleCopyMessage}
          onResendMessage={handleResendMessage}
          onEditMessage={handleEditMessage}
          onSuggestShellEdit={handleOpenShellEditPrompt}
        />

        <ChatComposer
          pendingPermissionRequests={pendingPermissionRequests}
          handlePermissionDecision={handlePermissionDecision}
          handleGrantToolPermission={handleGrantToolPermission}
          claudeStatus={claudeStatus ? { ...claudeStatus, text: statusTextOverride || claudeStatus.text } : claudeStatus}
          isLoading={isLoading}
          onAbortSession={handleAbortSession}
          provider={provider}
          permissionMode={permissionMode}
          onModeSwitch={cyclePermissionMode}
          codexModel={codexModel}
          codexReasoningEffort={codexReasoningEffort}
          setCodexReasoningEffort={setCodexReasoningEffort}
          tokenBudget={tokenBudget}
          slashCommandsCount={slashCommandsCount}
          onToggleCommandMenu={handleToggleCommandMenu}
          hasInput={Boolean(input.trim()) || attachedFiles.length > 0}
          onClearInput={handleClearInput}
          isUserScrolledUp={isUserScrolledUp}
          hasMessages={chatMessages.length > 0}
          onScrollToBottom={scrollToBottomAndReset}
          onSubmit={handleSubmit}
          isDragActive={isDragActive}
          attachedFiles={attachedFiles}
          onRemoveFile={removeAttachedFile}
          uploadingFiles={uploadingFiles}
          fileErrors={fileErrors}
          showFileDropdown={showFileDropdown}
          filteredFiles={filteredFiles}
          selectedFileIndex={selectedFileIndex}
          onSelectFile={selectFile}
          filteredCommands={filteredCommands}
          selectedCommandIndex={selectedCommandIndex}
          onCommandSelect={handleCommandSelect}
          onCloseCommandMenu={resetCommandMenuState}
          isCommandMenuOpen={showCommandMenu}
          frequentCommands={commandQuery ? [] : frequentCommands}
          getRootProps={getRootProps as (...args: unknown[]) => Record<string, unknown>}
          getInputProps={getInputProps as (...args: unknown[]) => Record<string, unknown>}
          openFilePicker={openFilePicker}
          inputHighlightRef={inputHighlightRef}
          renderInputWithMentions={renderInputWithMentions}
          textareaRef={textareaRef}
          input={input}
          setInput={setInput}
          onInputChange={handleInputChange}
          onTextareaClick={handleTextareaClick}
          onTextareaKeyDown={handleKeyDown}
          onTextareaPaste={handlePaste}
          onTextareaScrollSync={syncInputOverlayScroll}
          onTextareaInput={handleTextareaInput}
          onInputFocusChange={handleInputFocusChange}
          isInputFocused={isInputFocused}
          placeholder={
            isEmpty && newSessionMode === 'workspace_qa'
              ? t('session.mode.workspaceQaPlaceholder', { defaultValue: 'Ask about any file, module, or implementation detail...' })
              : t('input.placeholder', { provider: getProviderDisplayName(provider) })
          }
          isTextareaExpanded={isTextareaExpanded}
          sendByCtrlEnter={sendByCtrlEnter}
          onTranscript={handleTranscript}
          projectName={selectedProject?.name}
          onReferenceContext={(context) => {
            setInput((prev) => prev ? `${prev}\n\n${context}` : context);
          }}
          attachedPrompt={attachedPrompt}
          onRemoveAttachedPrompt={() => setAttachedPrompt(null)}
          onUpdateAttachedPrompt={(text) =>
            setAttachedPrompt((prev) => prev ? { ...prev, promptText: text } : null)
          }
          centered={isEmpty}
          setAttachedPrompt={setAttachedPrompt}
          setCodexModel={setCodexModel}
          newSessionMode={newSessionMode}
          onNewSessionModeChange={onNewSessionModeChange}
        />

        {isEmpty && newSessionMode === 'research' && (
          <GuidedPromptStarter
            projectName={selectedProject?.name || ''}
            setInput={setInput}
            textareaRef={textareaRef}
            setAttachedPrompt={setAttachedPrompt}
          />
        )}

        {editingFile && selectedProject && (
          <CodeEditor
            file={editingFile}
            onClose={handleCloseEditor}
            projectPath={selectedProject.fullPath || selectedProject.path}
            selectedProject={selectedProject}
            onStartWorkspaceQa={onStartWorkspaceQa}
            displayMode="embedded"
          />
        )}

          </div>
        </div>

        <ChatContextSidebar
          selectedProject={selectedProject}
          selectedSession={selectedSession}
          currentSessionId={currentSessionId}
          provider={provider}
          newSessionMode={newSessionMode}
          chatMessages={chatMessages}
          onFileOpen={handleFileOpen}
          activeSidebarTab={sidebarTab}
          onSidebarTabChange={setSidebarTab}
          isCollapsed={isSidebarCollapsed}
          onCollapsedChange={setIsSidebarCollapsed}
          onStartWorkspaceQa={onStartWorkspaceQa ?? undefined}
          onStartTask={handleStartTaskInChat}
        />
      </div>

      {isShellEditPromptOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={handleCloseShellEditPrompt}
          />
          <div className="relative z-10 w-full max-w-md rounded-2xl border border-border bg-background shadow-2xl">
            <div className="px-5 py-4">
              <h3 className="text-base font-semibold text-foreground">
                {t('shell.historyEdit.promptTitle')}
              </h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {t('shell.historyEdit.promptDescription')}
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
              <Button variant="outline" onClick={handleCloseShellEditPrompt}>
                {t('shell.historyEdit.cancel')}
              </Button>
              <Button onClick={handleConfirmOpenShell}>
                {t('shell.historyEdit.confirm')}
              </Button>
            </div>
          </div>
        </div>
      )}

      <QuickSettingsPanel />
      <BtwOverlay state={btwOverlay} onClose={closeBtwOverlay} />
    </>
  );
}

export default React.memo(ChatInterface);
