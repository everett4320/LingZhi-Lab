import type {
  Project,
  ProjectSession,
  SessionMode,
  SessionProvider,
} from '../types/app';
import { DEFAULT_PROVIDER, normalizeProvider } from '../utils/providerPolicy';
import { parseSessionScopeKey } from '../utils/sessionScope';

export type ProjectSessionArrayKey =
  | 'codexSessions';

export const FALLBACK_SESSION_NAME_BY_PROVIDER: Record<SessionProvider, string> = {
  codex: 'Codex Session',
};

export function resolveProjectSessionArrayKey(
  provider: SessionProvider | string | null | undefined,
): ProjectSessionArrayKey | null {
  const normalizedProvider = normalizeProvider((provider || DEFAULT_PROVIDER) as SessionProvider);
  return 'codexSessions';
}

function sessionsMatchIdentity(
  session: ProjectSession,
  provider: SessionProvider,
  sessionId: string,
): boolean {
  return (
    session.id === sessionId &&
    normalizeProvider((session.__provider || provider) as SessionProvider) === provider
  );
}

type UpsertProviderSessionOptions = {
  provider: SessionProvider;
  sessionId: string;
  projectName: string;
  mode?: SessionMode;
  displayName?: string;
  createdAt?: string;
  temporarySessionId?: string | null;
  activeTurnId?: string | undefined;
  touchLastActivity?: boolean;
};

export function upsertProviderSessionList(
  sessions: ProjectSession[] | undefined,
  options: UpsertProviderSessionOptions,
): ProjectSession[] {
  const currentSessions = Array.isArray(sessions) ? sessions : [];
  const {
    provider,
    sessionId,
    projectName,
    mode,
    displayName,
    createdAt,
    temporarySessionId = null,
    activeTurnId = undefined,
    touchLastActivity = true,
  } = options;
  const timestamp = createdAt || new Date().toISOString();
  const fallbackName = FALLBACK_SESSION_NAME_BY_PROVIDER[provider] || 'New Session';
  const summary = displayName || fallbackName;

  let hasTargetSession = false;
  const nextSessions: ProjectSession[] = [];

  for (const session of currentSessions) {
    if (
      temporarySessionId &&
      session.id === temporarySessionId &&
      normalizeProvider((session.__provider || provider) as SessionProvider) === provider
    ) {
      continue;
    }

    if (!sessionsMatchIdentity(session, provider, sessionId)) {
      nextSessions.push(session);
      continue;
    }

    if (hasTargetSession) {
      // Drop accidental duplicates while preserving the first canonical item.
      continue;
    }

    hasTargetSession = true;
    const stableLastActivity =
      session.lastActivity ||
      session.createdAt ||
      timestamp;
    nextSessions.push({
      ...session,
      id: sessionId,
      name: displayName || session.name || summary,
      summary: displayName || session.summary || summary,
      mode: mode || session.mode || 'research',
      activeTurnId,
      __provider: provider,
      __projectName: projectName,
      createdAt: session.createdAt || timestamp,
      lastActivity: touchLastActivity ? timestamp : stableLastActivity,
    });
  }

  if (!hasTargetSession) {
    nextSessions.unshift({
      id: sessionId,
      name: summary,
      summary,
      mode: mode || 'research',
      activeTurnId,
      __provider: provider,
      __projectName: projectName,
      createdAt: timestamp,
      lastActivity: timestamp,
    });
  }

  return nextSessions;
}

type UpsertProjectSessionOptions = Omit<UpsertProviderSessionOptions, 'provider'> & {
  provider: SessionProvider | string | null | undefined;
};

export function upsertProjectSession(
  project: Project,
  options: UpsertProjectSessionOptions,
): Project {
  const normalizedProvider = normalizeProvider(
    (options.provider || DEFAULT_PROVIDER) as SessionProvider,
  );
  const sessionArrayKey = resolveProjectSessionArrayKey(normalizedProvider);
  if (!sessionArrayKey) {
    return project;
  }

  const nextSessions = upsertProviderSessionList(
    project[sessionArrayKey] as ProjectSession[] | undefined,
    {
      ...options,
      provider: normalizedProvider,
    },
  );

  const currentSessions = project[sessionArrayKey] as ProjectSession[] | undefined;
  if (currentSessions === nextSessions) {
    return project;
  }

  return {
    ...project,
    [sessionArrayKey]: nextSessions,
  };
}

function getScopedTrackingSessionId(trackingKey: string): string {
  if (!trackingKey) {
    return '';
  }
  const parsed = parseSessionScopeKey(trackingKey);
  return parsed?.sessionId || trackingKey;
}

export function hasTrackedTemporarySession(activeSessions: Set<string>): boolean {
  for (const trackingKey of activeSessions) {
    const sessionId = getScopedTrackingSessionId(trackingKey);
    if (sessionId.startsWith('new-session-') || sessionId.startsWith('temp-')) {
      return true;
    }
  }
  return false;
}

type TrackedSessionIdentity = {
  sessionId: string;
  provider?: SessionProvider | string | null;
  projectName?: string | null;
};

export function isTrackedSessionActive(
  activeSessions: Set<string>,
  identity: TrackedSessionIdentity | null | undefined,
): boolean {
  if (!identity?.sessionId) {
    return false;
  }

  const sessionId = identity.sessionId;
  const normalizedProvider = identity.provider
    ? normalizeProvider(identity.provider as SessionProvider)
    : null;
  const normalizedProjectName = identity.projectName || null;

  for (const trackingKey of activeSessions) {
    if (trackingKey === sessionId) {
      return true;
    }

    const parsed = parseSessionScopeKey(trackingKey);
    if (!parsed || parsed.sessionId !== sessionId) {
      continue;
    }

    if (normalizedProjectName && parsed.projectName !== normalizedProjectName) {
      continue;
    }

    if (normalizedProvider && parsed.provider !== normalizedProvider) {
      continue;
    }

    return true;
  }

  return false;
}
