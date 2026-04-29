import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import { api, authenticatedFetch } from '../utils/api';
import { queueWorkspaceQaDraft } from '../utils/workspaceQa';
import { queueReferenceChatDraft } from '../utils/referenceChatDraft';
import type { Reference } from '../components/references/types';
import { formatReferenceChatPrompt } from '../components/references/types';
import {
  OPTIMISTIC_SESSION_CREATED_EVENT,
  type OptimisticSessionCreatedDetail,
} from '../constants/sessionEvents';
import { normalizeProvider } from '../utils/providerPolicy';
import { isTemporarySessionId } from '../utils/sessionScope';
import {
  isTrackedSessionActive,
  upsertProjectSession,
} from './projectsSessionSync';
import type {
  AppSocketMessage,
  AppTab,
  ImportedProjectAnalysisPrompt,
  LoadingProgress,
  ProjectCreationOptions,
  Project,
  ProjectSession,
  ProjectsUpdatedMessage,
  PendingAutoIntake,
  SessionMode,
  SessionProvider,
  SessionTag,
  TrashProject,
} from '../types/app';
import { isTelemetryEnabled } from '../utils/telemetry';

declare global {
  interface Window {
    handleProjectCreatedWithIntake?: (project: Project, options?: ProjectCreationOptions) => void;
    refreshProjects?: () => Promise<void>;
    refreshTrashProjects?: () => Promise<void>;
  }
}

const SESSION_MODE_STORAGE_KEY = 'lingzhi-lab-new-session-mode';
const LAST_CHAT_SELECTION_STORAGE_KEY = 'lingzhi-lab-last-chat-selection';

const isSessionMode = (value: string | null | undefined): value is SessionMode =>
  value === 'research' || value === 'workspace_qa';

const readStoredNewSessionMode = (): SessionMode => {
  if (typeof window === 'undefined') {
    return 'research';
  }

  const stored = window.sessionStorage.getItem(SESSION_MODE_STORAGE_KEY);
  return isSessionMode(stored) ? stored : 'research';
};

const persistNewSessionMode = (mode: SessionMode) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.sessionStorage.setItem(SESSION_MODE_STORAGE_KEY, mode);
};

type UseProjectsStateArgs = {
  sessionId?: string;
  navigate: NavigateFunction;
  latestMessage: AppSocketMessage | null;
  isMobile: boolean;
  activeSessions: Set<string>;
};

type SessionTagsUpdatedDetail = {
  projectName: string;
  sessionId: string;
  provider?: SessionProvider;
  tags: SessionTag[];
};

type LastChatSelection = {
  projectName: string;
  sessionId?: string | null;
  provider?: SessionProvider | null;
};

const serialize = (value: unknown) => JSON.stringify(value ?? null);

const projectsHaveChanges = (
  prevProjects: Project[],
  nextProjects: Project[],
): boolean => {
  if (prevProjects.length !== nextProjects.length) {
    return true;
  }

  return nextProjects.some((nextProject, index) => {
    const prevProject = prevProjects[index];
    if (!prevProject) {
      return true;
    }

    const baseChanged =
      nextProject.name !== prevProject.name ||
      nextProject.displayName !== prevProject.displayName ||
      nextProject.fullPath !== prevProject.fullPath ||
      serialize(nextProject.sessionMeta) !== serialize(prevProject.sessionMeta);

    if (baseChanged) {
      return true;
    }

    return serialize(nextProject.codexSessions) !== serialize(prevProject.codexSessions);
  });
};

const getProjectSessions = (project: Project): ProjectSession[] => {
  return [...(project.codexSessions ?? [])];
};

const readLastChatSelection = (): LastChatSelection | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(LAST_CHAT_SELECTION_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as LastChatSelection;
    if (!parsed || typeof parsed.projectName !== 'string' || parsed.projectName.trim().length === 0) {
      return null;
    }

    return {
      projectName: parsed.projectName.trim(),
      sessionId:
        typeof parsed.sessionId === 'string' && parsed.sessionId.trim().length > 0
          ? parsed.sessionId.trim()
          : null,
      provider:
        parsed.provider === 'codex'
          ? 'codex'
          : null,
    };
  } catch {
    return null;
  }
};

const persistLastChatSelection = (
  selection: LastChatSelection | null,
) => {
  if (typeof window === 'undefined') {
    return;
  }

  if (!selection || !selection.projectName) {
    window.localStorage.removeItem(LAST_CHAT_SELECTION_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(
    LAST_CHAT_SELECTION_STORAGE_KEY,
    JSON.stringify({
      projectName: selection.projectName,
      sessionId: selection.sessionId || null,
      provider: selection.provider || null,
    }),
  );
};

const matchesSessionIdentity = (
  session: ProjectSession,
  detail: SessionTagsUpdatedDetail,
  providerHint?: SessionProvider,
): boolean => {
  if (session.id !== detail.sessionId) {
    return false;
  }

  if (!detail.provider) {
    return true;
  }

  return (session.__provider || providerHint || 'codex') === detail.provider;
};

const applySessionTagsToList = (
  sessions: ProjectSession[] | undefined,
  detail: SessionTagsUpdatedDetail,
  providerHint: SessionProvider,
): ProjectSession[] | undefined => {
  if (!Array.isArray(sessions)) {
    return sessions;
  }

  let changed = false;
  const nextSessions = sessions.map((session) => {
    if (!matchesSessionIdentity(session, detail, providerHint)) {
      return session;
    }

    if (serialize(session.tags) === serialize(detail.tags)) {
      return session;
    }

    changed = true;
    return {
      ...session,
      tags: detail.tags,
    };
  });

  return changed ? nextSessions : sessions;
};

const applySessionTagsToProject = (
  project: Project,
  detail: SessionTagsUpdatedDetail,
): Project => {
  if (!project || project.name !== detail.projectName) {
    return project;
  }

  const nextCodexSessions = applySessionTagsToList(project.codexSessions, detail, 'codex');

  if (nextCodexSessions === project.codexSessions) {
    return project;
  }

  return {
    ...project,
    codexSessions: nextCodexSessions,
  };
};

const buildTransientSession = (
  sessionId: string,
  provider: ProjectSession['__provider'] = 'codex',
  projectName?: string,
): ProjectSession => ({
    id: sessionId,
    name: 'New Session',
    summary: 'New Session',
    mode: 'research',
    __provider: provider,
    __projectName: projectName,
    createdAt: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
  });

export function useProjectsState({
  sessionId,
  navigate,
  latestMessage,
  isMobile,
  activeSessions,
}: UseProjectsStateArgs) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [trashProjects, setTrashProjects] = useState<TrashProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [selectedSession, setSelectedSession] = useState<ProjectSession | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [isLoadingTrashProjects, setIsLoadingTrashProjects] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState<LoadingProgress | null>(null);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState('agents');
  const [externalMessageUpdate, setExternalMessageUpdate] = useState(0);
  const [pendingAutoIntake, setPendingAutoIntake] = useState<PendingAutoIntake | null>(null);
  const [importedProjectAnalysisPrompt, setImportedProjectAnalysisPrompt] = useState<ImportedProjectAnalysisPrompt | null>(null);
  const [newSessionMode, setNewSessionMode] = useState<SessionMode>(() => readStoredNewSessionMode());
  const [hasAppliedInitialSelection, setHasAppliedInitialSelection] = useState(false);

  const loadingProgressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const projectsUpdateDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingProjectsMessageRef = useRef<ProjectsUpdatedMessage | null>(null);

  const trackSessionNavigation = useCallback((payload: Record<string, unknown>) => {
    if (!isTelemetryEnabled()) {
      return;
    }

    void authenticatedFetch('/api/telemetry/events', {
      method: 'POST',
      body: JSON.stringify({
        events: [
          {
            name: 'ui_session_navigation',
            source: 'frontend-ui',
            data: payload,
            clientAt: new Date().toISOString(),
          },
        ],
      }),
    }).catch(() => {});
  }, []);

  const fetchProjects = useCallback(async () => {
    try {
      setIsLoadingProjects(true);
      const projectsResponse = await api.projects();
      const projectData = (await projectsResponse.json()) as Project[];

      setProjects((prevProjects) => {
        if (prevProjects.length === 0) {
          return projectData;
        }

        return projectsHaveChanges(prevProjects, projectData)
          ? projectData
          : prevProjects;
      });
    } catch (error) {
      console.error('Error fetching projects:', error);
    } finally {
      setIsLoadingProjects(false);
    }
  }, []);

  const fetchTrashProjects = useCallback(async () => {
    try {
      setIsLoadingTrashProjects(true);
      const response = await api.trashedProjects();
      if (!response.ok) {
        return;
      }

      const trashData = (await response.json()) as TrashProject[];
      setTrashProjects(trashData);
    } catch (error) {
      console.error('Error fetching trashed projects:', error);
    } finally {
      setIsLoadingTrashProjects(false);
    }
  }, []);

  const openSettings = useCallback((tab = 'tools') => {
    setSettingsInitialTab(tab);
    setShowSettings(true);
  }, []);

  useEffect(() => {
    void fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    if (hasAppliedInitialSelection || sessionId || isLoadingProjects || projects.length === 0) {
      return;
    }

    const lastSelection = readLastChatSelection();
    if (!lastSelection) {
      setHasAppliedInitialSelection(true);
      return;
    }

    const targetProject = projects.find((project) => project.name === lastSelection.projectName);
    if (!targetProject) {
      setHasAppliedInitialSelection(true);
      return;
    }

    setSelectedProject(targetProject);

    if (lastSelection.sessionId) {
      const normalizedProvider = normalizeProvider(
        (lastSelection.provider || 'codex') as SessionProvider,
      ) as SessionProvider;
      const targetSession = getProjectSessions(targetProject).find((session) => (
        session.id === lastSelection.sessionId
        && normalizeProvider((session.__provider || 'codex') as SessionProvider) === normalizedProvider
      ));
      if (targetSession) {
        setSelectedSession({
          ...targetSession,
          __provider: targetSession.__provider || normalizedProvider,
          __projectName: targetSession.__projectName || targetProject.name,
        });
        setActiveTab('chat');
      } else {
        setSelectedSession(null);
      }
    } else {
      setSelectedSession(null);
      setActiveTab('chat');
    }

    setHasAppliedInitialSelection(true);
  }, [hasAppliedInitialSelection, isLoadingProjects, projects, sessionId]);

  useEffect(() => {
    if (sessionId) {
      return;
    }

    if (!hasAppliedInitialSelection || isLoadingProjects) {
      return;
    }

    if (!selectedProject) {
      persistLastChatSelection(null);
      return;
    }

    persistLastChatSelection({
      projectName: selectedProject.name,
      sessionId: selectedSession?.id || null,
      provider: normalizeProvider(
        (selectedSession?.__provider || 'codex') as SessionProvider,
      ) as SessionProvider,
    });
  }, [
    hasAppliedInitialSelection,
    isLoadingProjects,
    selectedProject?.name,
    selectedSession?.id,
    selectedSession?.__provider,
    sessionId,
  ]);

  useEffect(() => {
    if (activeTab === 'trash') {
      void fetchTrashProjects();
    }
  }, [activeTab, fetchTrashProjects]);

  // TODO: Replace CustomEvent-based session-tags-updated with a shared state
  // manager (e.g., Zustand store or React context) to avoid global event bus coupling.
  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const handleSessionTagsUpdated = (event: Event) => {
      const detail = (event as CustomEvent<SessionTagsUpdatedDetail>).detail;
      if (
        !detail
        || !detail.projectName
        || !detail.sessionId
        || !Array.isArray(detail.tags)
      ) {
        return;
      }

      setProjects((prevProjects) => {
        let changed = false;
        const nextProjects = prevProjects.map((project) => {
          const updatedProject = applySessionTagsToProject(project, detail);
          if (updatedProject !== project) {
            changed = true;
          }
          return updatedProject;
        });
        return changed ? nextProjects : prevProjects;
      });

      setSelectedProject((prevProject) => {
        if (!prevProject) {
          return prevProject;
        }

        const nextProject = applySessionTagsToProject(prevProject, detail);
        return nextProject;
      });

      setSelectedSession((prevSession) => {
        if (!prevSession || !matchesSessionIdentity(prevSession, detail)) {
          return prevSession;
        }

        if (serialize(prevSession.tags) === serialize(detail.tags)) {
          return prevSession;
        }

        return {
          ...prevSession,
          tags: detail.tags,
        };
      });
    };

    window.addEventListener('session-tags-updated', handleSessionTagsUpdated as EventListener);
    return () => {
      window.removeEventListener('session-tags-updated', handleSessionTagsUpdated as EventListener);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const handleOptimisticSessionCreated = (event: Event) => {
      const detail = (event as CustomEvent<OptimisticSessionCreatedDetail>).detail;
      if (
        !detail ||
        !detail.projectName ||
        !detail.sessionId ||
        !detail.provider
      ) {
        return;
      }

      const sessionMode: SessionMode = isSessionMode(detail.mode) ? detail.mode : 'research';
      const createdAt = detail.createdAt || new Date().toISOString();
      const displayName = detail.displayName || detail.summary;

      setProjects((prevProjects) => prevProjects.map((project) => {
        if (project.name !== detail.projectName) {
          return project;
        }

        return upsertProjectSession(project, {
          projectName: detail.projectName,
          provider: detail.provider,
          sessionId: detail.sessionId,
          mode: sessionMode,
          displayName,
          createdAt,
        });
      }));
    };

    window.addEventListener(
      OPTIMISTIC_SESSION_CREATED_EVENT,
      handleOptimisticSessionCreated as EventListener,
    );
    return () => {
      window.removeEventListener(
        OPTIMISTIC_SESSION_CREATED_EVENT,
        handleOptimisticSessionCreated as EventListener,
      );
    };
  }, []);

  useEffect(() => {
    if (!latestMessage) {
      return;
    }

    const isUnifiedSessionCreated = latestMessage.type === 'chat-session-created';
    if (isUnifiedSessionCreated && latestMessage.sessionId && latestMessage.provider) {
      const rawMode = latestMessage.mode;
      const modeValue = typeof rawMode === 'string' ? rawMode : null;
      const sessionMode: SessionMode = isSessionMode(modeValue) ? modeValue : 'research';
      const createdProvider = normalizeProvider(
        latestMessage.provider as ProjectSession['__provider'],
      ) as ProjectSession['__provider'];
      const createdDisplayName = latestMessage.displayName as string | undefined;
      const createdProjectName = latestMessage.projectName as string | undefined;
      const fallbackProjectName =
        selectedSession?.__projectName ||
        selectedProject?.name ||
        null;
      const effectiveProjectName = createdProjectName || fallbackProjectName;
      const selectedSessionProvider = normalizeProvider(
        (selectedSession?.__provider || createdProvider || 'codex') as SessionProvider,
      ) as SessionProvider;
      const selectedSessionProjectName =
        selectedSession?.__projectName || selectedProject?.name || null;
      const temporarySessionIdToReplace =
        isTemporarySessionId(selectedSession?.id) &&
          selectedSessionProvider === createdProvider &&
          selectedSessionProjectName &&
          effectiveProjectName &&
          selectedSessionProjectName === effectiveProjectName
          ? selectedSession?.id || null
          : null;

      setProjects((prevProjects) => prevProjects.map((project) => {
        const nextProject = {
          ...project,
          codexSessions: (project.codexSessions || []).map((session) => {
            if (session.id !== latestMessage.sessionId) {
              return session;
            }
            return {
              ...session,
              mode: sessionMode,
              __provider: session.__provider || 'codex',
            };
          }),
        };

        if (effectiveProjectName && project.name === effectiveProjectName && createdProvider) {
          return upsertProjectSession(nextProject, {
            projectName: effectiveProjectName,
            provider: createdProvider,
            sessionId: latestMessage.sessionId as string,
            mode: sessionMode,
            displayName: createdDisplayName,
            createdAt: new Date().toISOString(),
            temporarySessionId: temporarySessionIdToReplace,
          });
        }

        return nextProject;
      }));

      setSelectedSession((previous) => {
        if (!previous) {
          return previous;
        }

        if (previous.id === latestMessage.sessionId) {
          return {
            ...previous,
            mode: sessionMode,
            __provider: previous.__provider || createdProvider,
            __projectName: previous.__projectName || effectiveProjectName || undefined,
          };
        }

        if (
          isTemporarySessionId(previous.id) &&
          temporarySessionIdToReplace &&
          previous.id === temporarySessionIdToReplace
        ) {
          return {
            ...previous,
            id: latestMessage.sessionId as string,
            mode: sessionMode,
            name: createdDisplayName || previous.name,
            summary: createdDisplayName || previous.summary,
            __provider: createdProvider,
            __projectName: effectiveProjectName || previous.__projectName,
            createdAt: previous.createdAt || new Date().toISOString(),
            lastActivity: new Date().toISOString(),
          };
        }

        if (previous.id !== latestMessage.sessionId) {
          return previous;
        }

        return previous;
      });
    }

    if (latestMessage.type === 'loading_progress') {
      if (loadingProgressTimeoutRef.current) {
        clearTimeout(loadingProgressTimeoutRef.current);
        loadingProgressTimeoutRef.current = null;
      }

      setLoadingProgress(latestMessage as LoadingProgress);

      if (latestMessage.phase === 'complete') {
        loadingProgressTimeoutRef.current = setTimeout(() => {
          setLoadingProgress(null);
          loadingProgressTimeoutRef.current = null;
        }, 500);
      }

      return;
    }

    if (latestMessage.type === 'session-status' && latestMessage.sessionId) {
      const statusSessionId = latestMessage.sessionId as string;
      const statusProjectName = (latestMessage.projectName as string | undefined)
        || selectedProject?.name
        || null;
      const statusProvider = normalizeProvider(
        (latestMessage.provider as SessionProvider | undefined) || 'codex',
      ) as SessionProvider;
      const activeTurnId =
        typeof latestMessage.activeTurnId === 'string' && latestMessage.activeTurnId.trim().length > 0
          ? latestMessage.activeTurnId.trim()
          : undefined;

      if (statusProjectName) {
        setProjects((prevProjects) => prevProjects.map((project) => {
          if (project.name !== statusProjectName) {
            return project;
          }

          return upsertProjectSession(project, {
            projectName: statusProjectName,
            provider: statusProvider,
            sessionId: statusSessionId,
            activeTurnId,
            createdAt: new Date().toISOString(),
            touchLastActivity: false,
          });
        }));
      }

      setSelectedSession((previous) => {
        if (!previous || previous.id !== statusSessionId) {
          return previous;
        }
        if (previous.activeTurnId === activeTurnId) {
          return previous;
        }
        return {
          ...previous,
          activeTurnId,
        };
      });

      return;
    }

    if (latestMessage.type === 'chat-turn-accepted' && latestMessage.sessionId) {
      const acceptedSessionId = latestMessage.sessionId as string;
      const acceptedProjectName = (latestMessage.projectName as string | undefined)
        || selectedProject?.name
        || null;
      const acceptedProvider = normalizeProvider(
        (latestMessage.provider as SessionProvider | undefined) || 'codex',
      ) as SessionProvider;
      const acceptedTurnId =
        typeof latestMessage.turnId === 'string' && latestMessage.turnId.trim().length > 0
          ? latestMessage.turnId.trim()
          : undefined;

      if (acceptedProjectName) {
        setProjects((prevProjects) => prevProjects.map((project) => {
          if (project.name !== acceptedProjectName) {
            return project;
          }

          return upsertProjectSession(project, {
            projectName: acceptedProjectName,
            provider: acceptedProvider,
            sessionId: acceptedSessionId,
            activeTurnId: acceptedTurnId,
            createdAt: new Date().toISOString(),
          });
        }));
      }

      setSelectedSession((previous) => {
        if (!previous || previous.id !== acceptedSessionId) {
          return previous;
        }
        if (previous.activeTurnId === acceptedTurnId) {
          return previous;
        }
        return {
          ...previous,
          activeTurnId: acceptedTurnId,
        };
      });

      return;
    }

    if (latestMessage.type === 'chat-turn-complete' && latestMessage.sessionId) {
      const completedSessionId = latestMessage.sessionId as string;
      const completedProjectName = (latestMessage.projectName as string | undefined)
        || selectedProject?.name
        || null;
      const completedProvider = normalizeProvider(
        (latestMessage.provider as SessionProvider | undefined) || 'codex',
      ) as SessionProvider;

      if (completedProjectName) {
        setProjects((prevProjects) => prevProjects.map((project) => {
          if (project.name !== completedProjectName) {
            return project;
          }

          return upsertProjectSession(project, {
            projectName: completedProjectName,
            provider: completedProvider,
            sessionId: completedSessionId,
            activeTurnId: undefined,
            createdAt: new Date().toISOString(),
          });
        }));
      }

      setSelectedSession((previous) => {
        if (!previous || previous.id !== completedSessionId) {
          return previous;
        }
        if (previous.activeTurnId == null) {
          return previous;
        }
        return {
          ...previous,
          activeTurnId: undefined,
        };
      });

      return;
    }

    if (latestMessage.type !== 'projects_updated') {
      return;
    }

    pendingProjectsMessageRef.current = latestMessage as ProjectsUpdatedMessage;

    if (projectsUpdateDebounceRef.current) {
      return;
    }

    projectsUpdateDebounceRef.current = setTimeout(() => {
      projectsUpdateDebounceRef.current = null;
      const projectsMessage = pendingProjectsMessageRef.current;
      pendingProjectsMessageRef.current = null;

      if (!projectsMessage) {
        return;
      }

      if (projectsMessage.changedFile && selectedSession && selectedProject) {
        const normalized = projectsMessage.changedFile.replace(/\\/g, '/');
        const changedFileParts = normalized.split('/');

        if (changedFileParts.length >= 2) {
          const filename = changedFileParts[changedFileParts.length - 1];
          const changedSessionId = filename.replace('.jsonl', '');

          if (changedSessionId === selectedSession.id) {
            const isSessionActive = isTrackedSessionActive(activeSessions, {
              sessionId: selectedSession.id,
              provider: selectedSession.__provider,
              projectName: selectedSession.__projectName || selectedProject.name,
            });

            if (!isSessionActive) {
              setExternalMessageUpdate((prev) => prev + 1);
            }
          }
        }
      }

      const updatedProjects = projectsMessage.projects;

      setProjects(updatedProjects);
      if (activeTab === 'trash') {
        void fetchTrashProjects();
      }

      if (!selectedProject) {
        return;
      }

      const updatedSelectedProject = updatedProjects.find(
        (project) => project.name === selectedProject.name,
      );

      if (!updatedSelectedProject) {
        return;
      }

      if (serialize(updatedSelectedProject) !== serialize(selectedProject)) {
        setSelectedProject(updatedSelectedProject);
      }

      if (!selectedSession) {
        return;
      }

      const normalizedSelectedProvider = normalizeProvider(
        (selectedSession.__provider || 'codex') as SessionProvider,
      ) as SessionProvider;
      const selectedSessionProjectName =
        selectedSession.__projectName || selectedProject.name;
      const updatedSelectedSession = getProjectSessions(updatedSelectedProject).find(
        (session) => (
          session.id === selectedSession.id
          && normalizeProvider(
            (session.__provider || 'codex') as SessionProvider,
          ) === normalizedSelectedProvider
          && (session.__projectName || updatedSelectedProject.name) === selectedSessionProjectName
        ),
      );

      if (!updatedSelectedSession) {
        // Codex-only v4: projects_updated is reconciliation signal only.
        // Do not clear selectedSession here; explicit session-delete paths own removal.
        return;
      }

      if (serialize(updatedSelectedSession) !== serialize(selectedSession)) {
        setSelectedSession(updatedSelectedSession);
      }
    }, 250);
  }, [activeTab, activeSessions, fetchTrashProjects, latestMessage, selectedProject, selectedSession]);

  useEffect(() => {
    return () => {
      if (loadingProgressTimeoutRef.current) {
        clearTimeout(loadingProgressTimeoutRef.current);
        loadingProgressTimeoutRef.current = null;
      }
      if (projectsUpdateDebounceRef.current) {
        clearTimeout(projectsUpdateDebounceRef.current);
        projectsUpdateDebounceRef.current = null;
      }
      pendingProjectsMessageRef.current = null;
    };
  }, []);

  const handleNavigateToSession = useCallback((
    targetSessionId: string,
    targetProvider?: ProjectSession['__provider'],
    targetProjectName?: string,
    options?: { source?: 'user' | 'system' },
  ) => {
    if (!targetSessionId) {
      return;
    }
    const navigationSource = options?.source || 'user';

    const shouldSwitchTab = !selectedSession || selectedSession.id !== targetSessionId;
    let matchedProject: Project | null = null;
    let matchedSession: ProjectSession | null = null;

    const targetProject = targetProjectName
      ? projects.find((project) => project.name === targetProjectName)
      : null;

    for (const project of projects) {
      const codexSession = project.codexSessions?.find((session) => session.id === targetSessionId);
      if (codexSession) {
        matchedProject = project;
        matchedSession = { ...codexSession, __provider: 'codex' };
        break;
      }
    }

    const providerHint = targetProvider ?? matchedSession?.__provider;
    const sessionToSelect =
      matchedSession
      || (targetProvider ? buildTransientSession(targetSessionId, providerHint, targetProject?.name || selectedProject?.name) : null);

    const projectToSelect = matchedProject || targetProject;
    if (projectToSelect && selectedProject?.name !== projectToSelect.name) {
      setSelectedProject(projectToSelect);
    }

    if (sessionToSelect && (selectedSession?.id !== targetSessionId || selectedSession.__provider !== sessionToSelect.__provider)) {
      setSelectedSession(sessionToSelect);
    }

    if (shouldSwitchTab) {
      setActiveTab('chat');
    }

    if (sessionToSelect) {
      const routeProjectName = (sessionToSelect.__projectName || projectToSelect?.name || selectedProject?.name || targetProjectName);
      const routePath = routeProjectName
        ? `/session/${encodeURIComponent(routeProjectName)}/${encodeURIComponent(targetSessionId)}`
        : `/session/${encodeURIComponent(targetSessionId)}`;
      trackSessionNavigation({
        stage: 'handleNavigateToSession',
        source: navigationSource,
        fromSessionId: selectedSession?.id || null,
        toSessionId: targetSessionId,
        selectedProjectName: selectedProject?.name || null,
        targetProjectName: targetProjectName || null,
        matchedProjectName: matchedProject?.name || null,
        routePath,
      });
      navigate(routePath);
    }
  }, [navigate, projects, selectedProject?.name, selectedSession?.id, selectedSession?.__provider, trackSessionNavigation]);

  useEffect(() => {
    if (!sessionId || projects.length === 0) {
      return;
    }

    handleNavigateToSession(sessionId);
  }, [sessionId, projects, handleNavigateToSession]);

  const handleProjectSelect = useCallback(
    (project: Project) => {
      setSelectedProject(project);
      setSelectedSession(null);
      setActiveTab((currentTab) =>
        currentTab === 'dashboard' || currentTab === 'trash' || currentTab === 'news' || currentTab === 'skills'
          ? 'chat'
          : currentTab,
      );
      navigate('/');

      if (isMobile) {
        setSidebarOpen(false);
      }
    },
    [isMobile, navigate],
  );

  const handleSessionSelect = useCallback(
    (session: ProjectSession) => {
      const previousSessionId = selectedSession?.id || null;
      setSelectedSession(session);

      if (session.mode) {
        persistNewSessionMode(session.mode);
        setNewSessionMode(session.mode);
      }

      if (activeTab !== 'git' && activeTab !== 'preview') {
        setActiveTab('chat');
      }

      if (isMobile) {
        const sessionProjectName = session.__projectName;
        const currentProjectName = selectedProject?.name;

        if (sessionProjectName !== currentProjectName) {
          setSidebarOpen(false);
        }
      }

      const routeProjectName = session.__projectName || selectedProject?.name;
      const routePath = routeProjectName
        ? `/session/${encodeURIComponent(routeProjectName)}/${encodeURIComponent(session.id)}`
        : `/session/${encodeURIComponent(session.id)}`;
      trackSessionNavigation({
        stage: 'handleSessionSelect',
        source: 'user',
        fromSessionId: previousSessionId,
        toSessionId: session.id,
        selectedProjectName: selectedProject?.name || null,
        routePath,
      });
      if (routeProjectName) {
        navigate(routePath);
      } else {
        navigate(routePath);
      }
    },
    [activeTab, isMobile, navigate, selectedProject?.name, selectedSession?.id, trackSessionNavigation],
  );

  const handleNewSession = useCallback(
    (project: Project, mode: SessionMode = 'research') => {
      setSelectedProject(project);
      setSelectedSession(null);
      setActiveTab('chat');
      persistNewSessionMode(mode);
      setNewSessionMode(mode);
      navigate('/');

      if (isMobile) {
        setSidebarOpen(false);
      }
    },
    [isMobile, navigate],
  );

  const handleStartWorkspaceQa = useCallback(
    (project: Project, prompt: string) => {
      setSelectedProject(project);
      setSelectedSession(null);
      setActiveTab('chat');
      persistNewSessionMode('workspace_qa');
      setNewSessionMode('workspace_qa');
      queueWorkspaceQaDraft(project.name, prompt);
      navigate('/');

      if (isMobile) {
        setSidebarOpen(false);
      }
    },
    [isMobile, navigate],
  );

  const handleChatFromReference = useCallback(
    (project: Project, ref: Reference) => {
      setSelectedProject(project);
      setSelectedSession(null);
      setActiveTab('chat');
      persistNewSessionMode('research');
      setNewSessionMode('research');
      queueReferenceChatDraft(project.name, {
        text: formatReferenceChatPrompt(ref),
        referenceId: ref.id,
        pdfCached: ref.pdf_cached === 1,
      });
      navigate('/');

      if (isMobile) {
        setSidebarOpen(false);
      }
    },
    [isMobile, navigate],
  );

  const handleProjectCreatedWithIntake = useCallback(
    (project: Project, options?: ProjectCreationOptions) => {
      setSelectedProject(project);
      setSelectedSession(null);
      setActiveTab('chat');
      setPendingAutoIntake(options?.autoIntake ?? null);
      setImportedProjectAnalysisPrompt(options?.importedProjectAnalysisPrompt ?? null);
      navigate('/');
      if (isMobile) setSidebarOpen(false);
    },
    [isMobile, navigate],
  );

  const clearPendingAutoIntake = useCallback(() => setPendingAutoIntake(null), []);
  const clearImportedProjectAnalysisPrompt = useCallback(() => setImportedProjectAnalysisPrompt(null), []);

  const handleOpenDashboard = useCallback(() => {
    setSelectedProject(null);
    setSelectedSession(null);
    setActiveTab('dashboard');
    navigate('/');

    if (isMobile) {
      setSidebarOpen(false);
    }
  }, [isMobile, navigate]);

  const handleOpenTrash = useCallback(() => {
    setSelectedProject(null);
    setSelectedSession(null);
    setActiveTab('trash');
    void fetchTrashProjects();
    navigate('/');

    if (isMobile) {
      setSidebarOpen(false);
    }
  }, [fetchTrashProjects, isMobile, navigate]);

  const handleOpenSkills = useCallback(() => {
    setSelectedProject(null);
    setSelectedSession(null);
    setActiveTab('skills');
    navigate('/');

    if (isMobile) {
      setSidebarOpen(false);
    }
  }, [isMobile, navigate]);

  const handleOpenNews = useCallback(() => {
    setSelectedProject(null);
    setSelectedSession(null);
    setActiveTab('news');
    navigate('/');

    if (isMobile) {
      setSidebarOpen(false);
    }
  }, [isMobile, navigate]);

  const handleOpenAutoResearch = useCallback(() => {
    setSelectedProject(null);
    setSelectedSession(null);
    setActiveTab('autoresearch');
    navigate('/');

    if (isMobile) {
      setSidebarOpen(false);
    }
  }, [isMobile, navigate]);

  const handleOpenCompute = useCallback(() => {
    setSelectedProject(null);
    setSelectedSession(null);
    setActiveTab('compute');
    navigate('/');

    if (isMobile) {
      setSidebarOpen(false);
    }
  }, [isMobile, navigate]);

  const handleSessionDelete = useCallback(
    (sessionIdToDelete: string) => {
      if (selectedSession?.id === sessionIdToDelete) {
        setSelectedSession(null);
        navigate('/');
      }

      const filterOut = (list?: ProjectSession[]) =>
        list?.filter((session) => session.id !== sessionIdToDelete) ?? [];

      setProjects((prevProjects) =>
        prevProjects.map((project) => ({
          ...project,
          codexSessions: filterOut(project.codexSessions),
          sessionMeta: {
            ...project.sessionMeta,
            total: Math.max(0, (project.sessionMeta?.total as number | undefined ?? 0) - 1),
          },
        })),
      );
    },
    [navigate, selectedSession?.id],
  );

  const handleSidebarRefresh = useCallback(async () => {
    try {
      const [projectsResponse, trashResponse] = await Promise.all([
        api.projects(),
        api.trashedProjects(),
      ]);
      const freshProjects = (await projectsResponse.json()) as Project[];
      const freshTrashProjects = trashResponse.ok ? await trashResponse.json() as TrashProject[] : [];

      setProjects((prevProjects) =>
        projectsHaveChanges(prevProjects, freshProjects) ? freshProjects : prevProjects,
      );
      setTrashProjects(freshTrashProjects);

      if (!selectedProject) {
        return;
      }

      const refreshedProject = freshProjects.find((project) => project.name === selectedProject.name);
      if (!refreshedProject) {
        return;
      }

      if (serialize(refreshedProject) !== serialize(selectedProject)) {
        setSelectedProject(refreshedProject);
      }

      if (!selectedSession) {
        return;
      }

      const refreshedSession = getProjectSessions(refreshedProject).find(
        (session) => session.id === selectedSession.id,
      );

      if (refreshedSession) {
        // Keep provider metadata stable when refreshed payload doesn't include __provider.
        const normalizedRefreshedSession =
          refreshedSession.__provider || !selectedSession.__provider
            ? refreshedSession
            : { ...refreshedSession, __provider: selectedSession.__provider };

        if (serialize(normalizedRefreshedSession) !== serialize(selectedSession)) {
          setSelectedSession(normalizedRefreshedSession);
        }
      }
    } catch (error) {
      console.error('Error refreshing sidebar:', error);
    }
  }, [selectedProject, selectedSession]);

  const handleProjectDelete = useCallback(
    (projectName: string) => {
      if (selectedProject?.name === projectName) {
        setSelectedProject(null);
        setSelectedSession(null);
        navigate('/');
      }

      setProjects((prevProjects) => prevProjects.filter((project) => project.name !== projectName));
    },
    [navigate, selectedProject?.name],
  );

  const sidebarSharedProps = useMemo(
    () => ({
      projects,
      selectedProject,
      selectedSession,
      onProjectSelect: handleProjectSelect,
      onSessionSelect: handleSessionSelect,
      onNewSession: handleNewSession,
      onSessionDelete: handleSessionDelete,
      onProjectDelete: handleProjectDelete,
      isLoading: isLoadingProjects,
      isTrashLoading: isLoadingTrashProjects,
      loadingProgress,
      onRefresh: handleSidebarRefresh,
      onShowSettings: () => setShowSettings(true),
      showSettings,
      settingsInitialTab,
      onCloseSettings: () => setShowSettings(false),
      isMobile,
      activeTab,
      onOpenDashboard: handleOpenDashboard,
      onOpenTrash: handleOpenTrash,
      onOpenSkills: handleOpenSkills,
      onOpenNews: handleOpenNews,
      onOpenAutoResearch: handleOpenAutoResearch,
      onOpenCompute: handleOpenCompute,
      onImportedProjectCreated: handleProjectCreatedWithIntake,
      importedProjectAnalysisPrompt,
      onDismissImportedProjectAnalysisPrompt: clearImportedProjectAnalysisPrompt,
      newSessionMode,
    }),
    [
      activeTab,
      clearImportedProjectAnalysisPrompt,
      handleNewSession,
      handleOpenDashboard,
      handleOpenAutoResearch,
      handleOpenCompute,
      handleOpenNews,
      handleOpenSkills,
      handleOpenTrash,
      handleProjectCreatedWithIntake,
      handleProjectDelete,
      handleProjectSelect,
      handleSessionDelete,
      handleSessionSelect,
      handleSidebarRefresh,
      importedProjectAnalysisPrompt,
      isLoadingProjects,
      isLoadingTrashProjects,
      isMobile,
      loadingProgress,
      newSessionMode,
      projects,
      selectedProject,
      selectedSession,
      settingsInitialTab,
      showSettings,
    ],
  );

  return {
    projects,
    trashProjects,
    selectedProject,
    selectedSession,
    activeTab,
    sidebarOpen,
    isLoadingProjects,
    isLoadingTrashProjects,
    loadingProgress,
    isInputFocused,
    showSettings,
    settingsInitialTab,
    externalMessageUpdate,
    importedProjectAnalysisPrompt,
    newSessionMode,
    setNewSessionMode,
    setActiveTab,
    setSidebarOpen,
    setIsInputFocused,
    setShowSettings,
    openSettings,
    fetchProjects,
    fetchTrashProjects,
    sidebarSharedProps,
    handleProjectSelect,
    handleSessionSelect,
    handleNavigateToSession,
    handleOpenDashboard,
    handleOpenTrash,
    handleOpenSkills,
    handleOpenNews,
    handleOpenAutoResearch,
    handleOpenCompute,
    handleNewSession,
    handleStartWorkspaceQa,
    handleChatFromReference,
    handleSessionDelete,
    handleProjectDelete,
    handleSidebarRefresh,
    pendingAutoIntake,
    handleProjectCreatedWithIntake,
    clearPendingAutoIntake,
    clearImportedProjectAnalysisPrompt,
  };
}


