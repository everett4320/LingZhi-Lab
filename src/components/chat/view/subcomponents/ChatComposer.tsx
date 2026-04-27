import CommandMenu from '../../../CommandMenu';
import ClaudeStatus from '../../../ClaudeStatus';
import { MicButton } from '../../../MicButton.jsx';
import ImageAttachment from './ImageAttachment';
import PermissionRequestsBanner from './PermissionRequestsBanner';
import ChatInputControls from './ChatInputControls';

import ReferencePicker from '../../../references/view/ReferencePicker';
import PromptBadgeDropdown from './PromptBadgeDropdown';
import { Plus } from 'lucide-react';
import { ListPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useState, useEffect } from 'react';
import type {
  ChangeEvent,
  ClipboardEvent,
  Dispatch,
  FormEvent,
  KeyboardEvent,
  MouseEvent,
  ReactNode,
  RefObject,
  SetStateAction,
  TouchEvent,
} from 'react';
import type { CodexReasoningEffortId } from '../../constants/codexReasoningEfforts';
import type { AttachedPrompt, CodexInputMessage, PendingPermissionRequest, PermissionMode, Provider, TokenBudget } from '../../types/types';
import type { SessionMode, SessionProvider } from '../../../../types/app';
import { CODEX_MODELS } from '../../../../../shared/modelConstants';
import { isAutoResearchScenario } from '../../utils/autoResearch';

// New subcomponents
import SkillDropdown from './SkillDropdown';
import AutoResearchDropdown from './AutoResearchDropdown';
import ModelSelector from './ModelSelector';
import SessionModeSelector from './SessionModeSelector';

interface MentionableFile {
  name: string;
  path: string;
}

function getFileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

interface SlashCommand {
  name: string;
  description?: string;
  namespace?: string;
  path?: string;
  type?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

function getModelConfig(_p: SessionProvider) {
  return CODEX_MODELS;
}

interface ChatComposerProps {
  pendingPermissionRequests: PendingPermissionRequest[];
  handlePermissionDecision: (
    requestIds: string | string[],
    decision: { allow?: boolean; message?: string; rememberEntry?: string | null; updatedInput?: unknown },
  ) => void;
  handleGrantToolPermission: (suggestion: { entry: string; toolName: string }) => { success: boolean };
  claudeStatus: { text: string; tokens: number; can_interrupt: boolean } | null;
  isLoading: boolean;
  onAbortSession: () => void;
  provider: Provider | string;
  permissionMode: PermissionMode | string;
  onModeSwitch: () => void;
  codexModel: string;
  codexReasoningEffort: CodexReasoningEffortId;
  setCodexReasoningEffort: Dispatch<SetStateAction<CodexReasoningEffortId>>;
  tokenBudget: TokenBudget | null;
  slashCommandsCount: number;
  onToggleCommandMenu: () => void;
  hasInput: boolean;
  onClearInput: () => void;
  isUserScrolledUp: boolean;
  hasMessages: boolean;
  onScrollToBottom: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement> | MouseEvent<HTMLButtonElement> | TouchEvent<HTMLButtonElement>) => void;
  onQueue?: (event: MouseEvent<HTMLButtonElement> | TouchEvent<HTMLButtonElement>) => void;
  isDragActive: boolean;
  attachedFiles: File[];
  onRemoveFile: (index: number) => void;
  uploadingFiles: Map<string, number>;
  fileErrors: Map<string, string>;
  showFileDropdown: boolean;
  filteredFiles: MentionableFile[];
  selectedFileIndex: number;
  onSelectFile: (file: MentionableFile) => void;
  filteredCommands: SlashCommand[];
  selectedCommandIndex: number;
  onCommandSelect: (command: SlashCommand, index: number, isHover: boolean) => void;
  onCloseCommandMenu: () => void;
  isCommandMenuOpen: boolean;
  frequentCommands: SlashCommand[];
  getRootProps: (...args: unknown[]) => Record<string, unknown>;
  getInputProps: (...args: unknown[]) => Record<string, unknown>;
  openFilePicker: () => void;
  inputHighlightRef: RefObject<HTMLDivElement>;
  renderInputWithMentions: (text: string) => ReactNode;
  textareaRef: RefObject<HTMLTextAreaElement>;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  onInputChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onTextareaClick: (event: MouseEvent<HTMLTextAreaElement>) => void;
  onTextareaKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onTextareaPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  onTextareaScrollSync: (target: HTMLTextAreaElement) => void;
  onTextareaInput: (event: FormEvent<HTMLTextAreaElement>) => void;
  onInputFocusChange?: (focused: boolean) => void;
  isInputFocused?: boolean;
  placeholder: string;
  isTextareaExpanded: boolean;
  sendByCtrlEnter?: boolean;
  onTranscript: (text: string) => void;
  projectName?: string;
  onReferenceContext?: (context: string) => void;
  attachedPrompt: AttachedPrompt | null;
  onRemoveAttachedPrompt: () => void;
  onUpdateAttachedPrompt: (promptText: string) => void;
  centered?: boolean;
  setAttachedPrompt?: (prompt: AttachedPrompt | null) => void;
  setCodexModel?: (model: string) => void;
  newSessionMode?: SessionMode;
  onNewSessionModeChange?: (mode: SessionMode) => void;
  rejectedSteersPreview?: CodexInputMessage[];
  pendingSteersPreview?: CodexInputMessage[];
  queuedFollowupPreview?: CodexInputMessage[];
  onRestoreLastQueued?: () => void;
}

export default function ChatComposer({
  pendingPermissionRequests,
  handlePermissionDecision,
  handleGrantToolPermission,
  claudeStatus,
  isLoading,
  onAbortSession,
  provider,
  permissionMode,
  onModeSwitch,
  codexModel,
  codexReasoningEffort,
  setCodexReasoningEffort,
  tokenBudget,
  slashCommandsCount,
  onToggleCommandMenu,
  hasInput,
  onClearInput,
  isUserScrolledUp,
  hasMessages,
  onScrollToBottom,
  onSubmit,
  onQueue,
  isDragActive,
  attachedFiles,
  onRemoveFile,
  uploadingFiles,
  fileErrors,
  showFileDropdown,
  filteredFiles,
  selectedFileIndex,
  onSelectFile,
  filteredCommands,
  selectedCommandIndex,
  onCommandSelect,
  onCloseCommandMenu,
  isCommandMenuOpen,
  frequentCommands,
  getRootProps,
  getInputProps,
  openFilePicker,
  inputHighlightRef,
  renderInputWithMentions,
  textareaRef,
  input,
  setInput,
  onInputChange,
  onTextareaClick,
  onTextareaKeyDown,
  onTextareaPaste,
  onTextareaScrollSync,
  onTextareaInput,
  onInputFocusChange,
  isInputFocused,
  placeholder,
  isTextareaExpanded,
  sendByCtrlEnter,
  onTranscript,
  projectName,
  onReferenceContext,
  attachedPrompt,
  onRemoveAttachedPrompt,
  onUpdateAttachedPrompt,
  centered,
  setAttachedPrompt,
  setCodexModel,
  newSessionMode,
  onNewSessionModeChange,
  rejectedSteersPreview = [],
  pendingSteersPreview = [],
  queuedFollowupPreview = [],
  onRestoreLastQueued,
}: ChatComposerProps) {
  const { t } = useTranslation('chat');
  const [showReferencePicker, setShowReferencePicker] = useState(false);
  const AnyCommandMenu = CommandMenu as any;
  const textareaRect = textareaRef.current?.getBoundingClientRect();
  const commandMenuPosition = {
    top: textareaRect ? Math.max(16, textareaRect.top - 316) : 0,
    left: textareaRect ? textareaRect.left : 16,
    bottom: textareaRect ? window.innerHeight - textareaRect.top + 8 : 90,
  };

  // Detect if the AskUserQuestion interactive panel is active
  const hasQuestionPanel = pendingPermissionRequests.some(
    (r) => r.toolName === 'AskUserQuestion'
  );

  // On mobile, when input is focused, float the input box at the bottom
  const mobileFloatingClass = isInputFocused
    ? 'max-sm:fixed max-sm:bottom-0 max-sm:left-0 max-sm:right-0 max-sm:z-50 max-sm:bg-background max-sm:shadow-[0_-4px_20px_rgba(0,0,0,0.15)]'
    : '';

  // Provider/model handling for centered mode
  const sessionProvider = provider as SessionProvider;
  const currentModel = codexModel;
  const modelConfig = getModelConfig(sessionProvider);

  const handleModelChange = (value: string) => {
    setCodexModel?.(value);
    localStorage.setItem('codex-model', value);
  };

  const sessionModeChoices: Array<{ id: SessionMode; titleKey: string }> = [
    { id: 'research', titleKey: 'session.mode.researchTitle' },
    { id: 'workspace_qa', titleKey: 'session.mode.workspaceQaTitle' },
  ];

  return (
    <div className={`px-2 pt-0 sm:px-4 sm:pt-1 md:px-4 md:pt-1 flex-shrink-0 ${centered ? 'pb-2 sm:pb-3' : 'pb-2 sm:pb-4 md:pb-6'} ${mobileFloatingClass}`}>
      <div className={`${centered ? 'max-w-3xl' : 'max-w-5xl'} mx-auto`}>
        <PermissionRequestsBanner
          provider={provider}
          pendingPermissionRequests={pendingPermissionRequests}
          handlePermissionDecision={handlePermissionDecision}
          handleGrantToolPermission={handleGrantToolPermission}
        />
      </div>

      {(rejectedSteersPreview.length > 0 || pendingSteersPreview.length > 0 || queuedFollowupPreview.length > 0) && (
        <div className={`mx-auto mb-2 ${centered ? 'max-w-3xl' : 'max-w-5xl'}`}>
          <div className="rounded-xl border border-border/50 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            {rejectedSteersPreview.length > 0 && (
              <div className="mb-1">
                <div className="font-semibold text-amber-600 dark:text-amber-400">Rejected steers</div>
                <div className="space-y-1">
                  {rejectedSteersPreview.map((entry) => (
                    <div key={entry.id} className="truncate">{entry.text || '[non-text input]'}</div>
                  ))}
                </div>
              </div>
            )}
            {pendingSteersPreview.length > 0 && (
              <div className="mb-1">
                <div className="font-semibold text-blue-600 dark:text-blue-400">Pending steers</div>
                <div className="space-y-1">
                  {pendingSteersPreview.map((entry) => (
                    <div key={entry.id} className="truncate">{entry.text || '[non-text input]'}</div>
                  ))}
                </div>
              </div>
            )}
            {queuedFollowupPreview.length > 0 && (
              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="font-semibold text-foreground">Queued follow-up messages</span>
                  <button
                    type="button"
                    onClick={() => onRestoreLastQueued?.()}
                    className="rounded border border-border/60 px-2 py-0.5 text-[11px] hover:bg-accent"
                    disabled={!onRestoreLastQueued}
                  >
                    Restore last
                  </button>
                </div>
                <div className="space-y-1">
                  {queuedFollowupPreview.map((entry) => (
                    <div key={entry.id} className="truncate">{entry.text || '[non-text input]'}</div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {!hasQuestionPanel && <form onSubmit={onSubmit as (event: FormEvent<HTMLFormElement>) => void} className={`relative mx-auto ${centered ? 'max-w-3xl' : 'max-w-5xl'}`}>

        {!centered && !hasQuestionPanel && (isLoading || (isUserScrolledUp && hasMessages)) && (
          <div className="pointer-events-none absolute bottom-full left-0 right-0 flex justify-center pb-1.5">
            <div className="pointer-events-auto relative flex items-center">
              <ClaudeStatus
                status={claudeStatus}
                isLoading={isLoading}
                onAbort={onAbortSession}
                provider={provider}
              />
              {isUserScrolledUp && hasMessages && (
                <button
                  onClick={onScrollToBottom}
                  className={`w-7 h-7 sm:w-8 sm:h-8 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg shadow-sm flex items-center justify-center transition-all duration-200 hover:scale-105 ${isLoading ? 'absolute left-full ml-2' : ''}`}
                >
                  <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        )}
        {isDragActive && (
          <div className="absolute inset-0 bg-primary/15 border-2 border-dashed border-primary/50 rounded-3xl flex items-center justify-center z-50">
            <div className="bg-card rounded-xl p-4 shadow-lg border border-border/30">
              <svg className="w-8 h-8 text-primary mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                />
              </svg>
              <p className="text-sm font-medium">{t('input.dropFilesHere')}</p>
            </div>
          </div>
        )}

        {attachedFiles.length > 0 && (
          <div className="mb-2 p-2 bg-muted/40 rounded-xl">
            <div className="flex flex-wrap gap-2">
              {attachedFiles.map((file, index) => (
                <ImageAttachment
                  key={index}
                  file={file}
                  onRemove={() => onRemoveFile(index)}
                  uploadProgress={uploadingFiles.get(getFileKey(file))}
                />
              ))}
            </div>
          </div>
        )}

        {fileErrors.size > 0 && (
          <div className="mb-2 rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm text-red-600">
            {[...new Set(fileErrors.values())].map((error) => (
              <div key={error} className="truncate">
                {error}
              </div>
            ))}
          </div>
        )}

        {showFileDropdown && filteredFiles.length > 0 && (
          <div className="absolute bottom-full left-0 right-0 mb-2 bg-card/95 backdrop-blur-md border border-border/50 rounded-xl shadow-lg max-h-48 overflow-y-auto z-50">
            {filteredFiles.map((file, index) => (
              <div
                key={file.path}
                className={`px-4 py-3 cursor-pointer border-b border-border/30 last:border-b-0 touch-manipulation ${
                  index === selectedFileIndex
                    ? 'bg-primary/8 text-primary'
                    : 'hover:bg-accent/50 text-foreground'
                }`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onSelectFile(file);
                }}
              >
                <div className="font-medium text-sm">{file.name}</div>
                <div className="text-xs text-muted-foreground font-mono">{file.path}</div>
              </div>
            ))}
          </div>
        )}

        {showReferencePicker && projectName && onReferenceContext && (
          <ReferencePicker
            projectName={projectName}
            onSelect={(context) => {
              onReferenceContext?.(context);
            }}
            onClose={() => setShowReferencePicker(false)}
          />
        )}

        <AnyCommandMenu
          commands={filteredCommands}
          selectedIndex={selectedCommandIndex}
          onSelect={onCommandSelect}
          onClose={onCloseCommandMenu}
          position={commandMenuPosition}
          isOpen={isCommandMenuOpen}
          frequentCommands={frequentCommands}
        />

        <div
          {...getRootProps()}
          className={`relative bg-card/80 backdrop-blur-sm rounded-3xl shadow-sm border border-border/50 focus-within:shadow-md focus-within:border-primary/30 focus-within:ring-1 focus-within:ring-primary/15 transition-all duration-200 ${isTextareaExpanded ? 'chat-input-expanded' : ''}`}
        >
          <input {...getInputProps()} />
          {attachedPrompt && (
            <PromptBadgeDropdown
              prompt={attachedPrompt}
              onRemove={onRemoveAttachedPrompt}
              onUpdate={onUpdateAttachedPrompt}
            />
          )}
          <div aria-hidden="true" className="absolute inset-0 pointer-events-none overflow-hidden rounded-3xl">
            <div className={`chat-input-placeholder block w-full pl-5 ${centered ? 'pr-16 pt-4 pb-2 text-sm' : 'pr-20 sm:pr-40 py-1.5 sm:py-4 text-base'} text-transparent leading-6 whitespace-pre-wrap break-words`}>
              {renderInputWithMentions(input)}
            </div>
          </div>

          <div className="relative z-10">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={onInputChange}
              onClick={onTextareaClick}
              onKeyDown={onTextareaKeyDown}
              onPaste={onTextareaPaste}
              onScroll={(event) => onTextareaScrollSync(event.target as HTMLTextAreaElement)}
              onFocus={() => onInputFocusChange?.(true)}
              onBlur={() => onInputFocusChange?.(false)}
              onInput={onTextareaInput}
              placeholder={placeholder}
              className={`chat-input-placeholder block w-full pl-5 ${centered ? 'pr-16 pt-4 pb-2 min-h-[72px] max-h-[200px] text-sm' : 'pr-20 sm:pr-40 py-1.5 sm:py-4 min-h-[50px] sm:min-h-[80px] max-h-[40vh] sm:max-h-[300px] text-base'} bg-transparent rounded-3xl focus:outline-none text-foreground placeholder-muted-foreground/50 resize-none overflow-y-auto leading-6 transition-all duration-200 ${isLoading && !input.trim().startsWith('/') ? 'opacity-50' : ''}`}
              style={{ height: centered ? '72px' : '50px' }}
            />
            <div className={`absolute ${centered ? 'right-11' : 'right-14'} top-1/2 transform -translate-y-1/2`}>
              <MicButton onTranscript={onTranscript} className={centered ? '!w-7 !h-7' : '!w-9 !h-9'} />
            </div>

            <button
              type="submit"
              disabled={
                (!input.trim() && attachedFiles.length === 0 && !attachedPrompt) ||
                (
                  isLoading &&
                  !input.trim().startsWith('/btw ') &&
                  !(
                    provider === 'codex' &&
                    input.trim().length > 0
                  )
                )
              }
              onMouseDown={(event) => {
                event.preventDefault();
                onSubmit(event);
              }}
              onTouchStart={(event) => {
                event.preventDefault();
                onSubmit(event);
              }}
              className={`absolute right-2 top-1/2 transform -translate-y-1/2 ${centered ? 'w-8 h-8 rounded-lg' : 'w-10 h-10 sm:w-11 sm:h-11 rounded-xl'} bg-primary hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed flex items-center justify-center transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:ring-offset-1 focus:ring-offset-background`}
            >
              <svg className={`${centered ? 'w-3.5 h-3.5' : 'w-4 h-4 sm:w-[18px] sm:h-[18px]'} text-primary-foreground transform rotate-90`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>

            {!centered && (
              <div
                className={`absolute bottom-1 left-5 right-14 sm:right-40 text-xs text-muted-foreground/50 pointer-events-none hidden sm:block transition-opacity duration-200 ${
                  input.trim() ? 'opacity-0' : 'opacity-100'
                }`}
              >
                {sendByCtrlEnter ? t('input.hintText.ctrlEnter') : t('input.hintText.enter')}
              </div>
            )}
          </div>

          {/* Bottom toolbar inside text box */}
          {!hasQuestionPanel && (
            <div className="relative z-10 border-t border-border/30">
              {/* Controls row */}
              <div className="flex items-center gap-2 px-4 py-2">
                {/* Left side */}
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={openFilePicker}
                    className="p-1 hover:bg-accent/60 rounded-full transition-colors flex items-center justify-center text-muted-foreground"
                    title={t('input.attachFiles')}
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                  {provider === 'codex' && isLoading && onQueue && (
                    <button
                      type="button"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        onQueue(event);
                      }}
                      onTouchStart={(event) => {
                        event.preventDefault();
                        onQueue(event);
                      }}
                      className="p-1 hover:bg-accent/60 rounded-full transition-colors flex items-center justify-center text-muted-foreground"
                      title="Queue follow-up"
                    >
                      <ListPlus className="w-4 h-4" />
                    </button>
                  )}

                  {/* Skill shortcuts — only in normal chat mode */}
                  {!centered && (
                    <>
                      <AutoResearchDropdown
                        setInput={setInput}
                        textareaRef={textareaRef}
                        setAttachedPrompt={setAttachedPrompt}
                      />
                      <SkillDropdown
                        setInput={setInput}
                        textareaRef={textareaRef}
                        setAttachedPrompt={setAttachedPrompt}
                        t={t}
                      />
                    </>
                  )}

                  {/* Session modes — only in empty state */}
                  {centered && onNewSessionModeChange && newSessionMode && (
                    <SessionModeSelector
                      choices={sessionModeChoices}
                      activeMode={newSessionMode}
                      onSelect={onNewSessionModeChange}
                      t={t}
                    />
                  )}
                </div>

                {/* Spacer */}
                <div className="flex-1" />

                {/* Right side */}
                <div className="flex items-center gap-1.5">
                  {/* Model selector */}
                  {modelConfig && (
                    <>
                      <ModelSelector
                        value={currentModel}
                        options={modelConfig.OPTIONS}
                        onChange={handleModelChange}
                      />
                    </>
                  )}

                  {isAutoResearchScenario(attachedPrompt?.scenarioId) && (
                    <span
                      className="text-[10px] text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30 px-1.5 py-0.5 rounded font-medium"
                      title="Autoresearch mode: tool permissions are auto-approved"
                    >
                      Auto
                    </span>
                  )}

                  {centered && <div className="h-4 border-l border-border/40 mx-1" />}

                  <ChatInputControls
                    permissionMode={isAutoResearchScenario(attachedPrompt?.scenarioId) ? 'bypassPermissions' : permissionMode}
                    onModeSwitch={onModeSwitch}
                    provider={provider}
                    codexModel={codexModel}
                    codexReasoningEffort={codexReasoningEffort}
                    setCodexReasoningEffort={setCodexReasoningEffort}
                    tokenBudget={tokenBudget}
                    slashCommandsCount={slashCommandsCount}
                    onToggleCommandMenu={onToggleCommandMenu}
                    hasInput={hasInput}
                    onClearInput={onClearInput}
                    hideCommandMenu
                    compact
                  />
                </div>
              </div>
            </div>
          )}

        </div>
      </form>}
    </div>
  );
}
