import { useCallback, useEffect, useRef, useState } from 'react';
import { CODEX_MODELS } from '../../../../shared/modelConstants';
import type { PendingPermissionRequest, PermissionMode } from '../types/types';
import type { ProjectSession, SessionProvider } from '../../../types/app';

interface UseChatProviderStateArgs {
  selectedSession: ProjectSession | null;
}

export function useChatProviderState({ selectedSession }: UseChatProviderStateArgs) {
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('default');
  const [pendingPermissionRequests, setPendingPermissionRequests] = useState<PendingPermissionRequest[]>([]);
  const [provider, setProvider] = useState<SessionProvider>('codex');
  const [codexModel, setCodexModel] = useState<string>(() => {
    return localStorage.getItem('codex-model') || CODEX_MODELS.DEFAULT;
  });

  const lastProviderRef = useRef(provider);

  const getProviderPermissionModes = useCallback((_p: SessionProvider): PermissionMode[] => {
    return ['default', 'acceptEdits', 'bypassPermissions'];
  }, []);

  const getProviderModeStorageKey = useCallback((p: SessionProvider) => `permissionMode-provider-${p}`, []);

  useEffect(() => {
    const validModes = getProviderPermissionModes(provider);
    const providerMode = localStorage.getItem(getProviderModeStorageKey(provider));
    const defaultMode: PermissionMode = validModes.includes((providerMode as PermissionMode))
      ? (providerMode as PermissionMode)
      : 'default';

    if (!selectedSession?.id) {
      setPermissionMode(defaultMode);
      return;
    }

    const savedMode = localStorage.getItem(`permissionMode-${selectedSession.id}`);
    if (savedMode && validModes.includes(savedMode as PermissionMode)) {
      setPermissionMode(savedMode as PermissionMode);
    } else {
      setPermissionMode(defaultMode);
    }
  }, [selectedSession?.id, provider, getProviderPermissionModes, getProviderModeStorageKey]);

  useEffect(() => {
    if (!selectedSession?.__provider || selectedSession.__provider === provider) {
      return;
    }
    // Codex-only runtime: hard-ignore non-codex sessions/providers.
    if (selectedSession.__provider !== 'codex') {
      return;
    }
    setProvider('codex');
    localStorage.setItem('selected-provider', 'codex');
  }, [provider, selectedSession]);

  useEffect(() => {
    if (lastProviderRef.current === provider) {
      return;
    }
    setPendingPermissionRequests([]);
    lastProviderRef.current = provider;
  }, [provider]);

  useEffect(() => {
    setPendingPermissionRequests((previous) =>
      previous.filter((request) => !request.sessionId || request.sessionId === selectedSession?.id),
    );
  }, [selectedSession?.id]);

  useEffect(() => {
    // Codex-only runtime: force canonical provider in storage.
    localStorage.setItem('selected-provider', 'codex');
  }, []);

  const cyclePermissionMode = useCallback(() => {
    const modes = getProviderPermissionModes(provider);

    const currentIndex = modes.indexOf(permissionMode);
    const nextIndex = (currentIndex + 1) % modes.length;
    const nextMode = modes[nextIndex];
    setPermissionMode(nextMode);
    localStorage.setItem(getProviderModeStorageKey(provider), nextMode);

    if (selectedSession?.id) {
      localStorage.setItem(`permissionMode-${selectedSession.id}`, nextMode);
    }
  }, [permissionMode, provider, selectedSession?.id, getProviderPermissionModes, getProviderModeStorageKey]);

  return {
    provider,
    setProvider,
    codexModel,
    setCodexModel,
    permissionMode,
    setPermissionMode,
    pendingPermissionRequests,
    setPendingPermissionRequests,
    cyclePermissionMode,
  };
}

