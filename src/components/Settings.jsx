import { useEffect, useMemo, useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { X, Settings as SettingsIcon, Moon, Sun, FolderOpen } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { useTranslation } from 'react-i18next';
import CredentialsSettings from './CredentialsSettings';
import GitSettings from './GitSettings';
import LoginModal from './LoginModal';
import { authenticatedFetch, api } from '../utils/api';
import { isTelemetryEnabled, setTelemetryEnabled } from '../utils/telemetry';
import { writeCliAvailability } from '../utils/cliAvailability';
import { useDesktop } from '../hooks/useDesktop';

import AgentListItem from './settings/AgentListItem';
import AccountContent from './settings/AccountContent';
import EmailSettingsContent from './settings/EmailSettingsContent';
import PermissionsContent from './settings/PermissionsContent';
import McpServersContent from './settings/McpServersContent';
import MemoryContent from './settings/MemoryContent';
import LanguageSelector from './LanguageSelector';

const VALID_SETTINGS_TABS = new Set(['agents', 'email', 'appearance', 'git', 'api']);

const buildDefaultAuthState = (overrides = {}) => ({
  authenticated: false,
  email: null,
  cliAvailable: true,
  cliCommand: 'codex',
  installHint: null,
  loading: false,
  error: null,
  installable: false,
  docsUrl: null,
  downloadUrl: null,
  ...overrides,
});

function Settings({ isOpen, onClose, projects = [], initialTab = 'agents' }) {
  const { isDarkMode, toggleDarkMode } = useTheme();
  const { t } = useTranslation('settings');
  const { isDesktop, selectDirectory, showItemInFolder } = useDesktop();

  const [activeTab, setActiveTab] = useState(
    VALID_SETTINGS_TABS.has(initialTab) ? initialTab : 'agents',
  );
  const [selectedCategory, setSelectedCategory] = useState('account');

  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);

  const [codeEditorTheme, setCodeEditorTheme] = useState(() =>
    localStorage.getItem('codeEditorTheme') || 'dark',
  );
  const [codeEditorWordWrap, setCodeEditorWordWrap] = useState(() =>
    localStorage.getItem('codeEditorWordWrap') === 'true',
  );
  const [codeEditorShowMinimap, setCodeEditorShowMinimap] = useState(() =>
    localStorage.getItem('codeEditorShowMinimap') !== 'false',
  );
  const [codeEditorLineNumbers, setCodeEditorLineNumbers] = useState(() =>
    localStorage.getItem('codeEditorLineNumbers') !== 'false',
  );
  const [codeEditorFontSize, setCodeEditorFontSize] = useState(() =>
    localStorage.getItem('codeEditorFontSize') || '14',
  );
  const [telemetryEnabled, setTelemetryEnabledState] = useState(() => isTelemetryEnabled());

  const [workspaceRoot, setWorkspaceRoot] = useState('');
  const [workspaceRootDefault, setWorkspaceRootDefault] = useState('');
  const [workspaceRootSaved, setWorkspaceRootSaved] = useState(false);
  const [workspaceRootError, setWorkspaceRootError] = useState('');

  const [codexPermissionMode, setCodexPermissionMode] = useState('default');
  const [codexMcpServers, setCodexMcpServers] = useState([]);
  const [showCodexMcpForm, setShowCodexMcpForm] = useState(false);
  const [editingCodexMcpServer, setEditingCodexMcpServer] = useState(null);
  const [codexMcpLoading, setCodexMcpLoading] = useState(false);
  const [codexMcpFormData, setCodexMcpFormData] = useState({
    name: '',
    type: 'stdio',
    config: {
      command: '',
      args: [],
      env: {},
    },
  });

  const [showLoginModal, setShowLoginModal] = useState(false);
  const [selectedProject, setSelectedProject] = useState(null);
  const [codexAuthStatus, setCodexAuthStatus] = useState(
    buildDefaultAuthState({ loading: true, cliCommand: 'codex' }),
  );

  const resetCodexMcpForm = () => {
    setCodexMcpFormData({
      name: '',
      type: 'stdio',
      config: { command: '', args: [], env: {} },
    });
    setEditingCodexMcpServer(null);
    setShowCodexMcpForm(false);
  };

  const fetchCodexMcpServers = async () => {
    try {
      const configResponse = await authenticatedFetch('/api/codex/mcp/config/read');
      if (configResponse.ok) {
        const configData = await configResponse.json();
        if (configData.success && configData.servers) {
          setCodexMcpServers(configData.servers);
          return;
        }
      }

      const cliResponse = await authenticatedFetch('/api/codex/mcp/cli/list');
      if (cliResponse.ok) {
        const cliData = await cliResponse.json();
        if (cliData.success && cliData.servers) {
          const servers = cliData.servers.map((server) => ({
            id: server.name,
            name: server.name,
            type: server.type || 'stdio',
            scope: 'user',
            config: {
              command: server.command || '',
              args: server.args || [],
              env: server.env || {},
            },
          }));
          setCodexMcpServers(servers);
        }
      }
    } catch (error) {
      console.error('Error fetching Codex MCP servers:', error);
    }
  };

  const saveCodexMcpServer = async (serverData) => {
    const response = await authenticatedFetch('/api/codex/mcp/cli/add', {
      method: 'POST',
      body: JSON.stringify({
        name: serverData.name,
        command: serverData.config?.command,
        args: serverData.config?.args || [],
        env: serverData.config?.env || {},
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to save Codex MCP server');
    }

    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error || 'Failed to save Codex MCP server');
    }

    await fetchCodexMcpServers();
  };

  const deleteCodexMcpServer = async (serverId) => {
    const response = await authenticatedFetch(`/api/codex/mcp/cli/remove/${serverId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to delete Codex MCP server');
    }

    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error || 'Failed to delete Codex MCP server');
    }

    await fetchCodexMcpServers();
  };

  const openCodexMcpForm = (server = null) => {
    if (server) {
      setEditingCodexMcpServer(server);
      setCodexMcpFormData({
        name: server.name,
        type: server.type || 'stdio',
        config: {
          command: server.config?.command || '',
          args: server.config?.args || [],
          env: server.config?.env || {},
        },
      });
    } else {
      resetCodexMcpForm();
    }
    setShowCodexMcpForm(true);
  };

  const handleCodexMcpSubmit = async (event) => {
    event.preventDefault();
    setCodexMcpLoading(true);
    try {
      if (editingCodexMcpServer) {
        await deleteCodexMcpServer(editingCodexMcpServer.name);
      }
      await saveCodexMcpServer(codexMcpFormData);
      resetCodexMcpForm();
      setSaveStatus('success');
    } catch (error) {
      alert(`Error: ${error.message}`);
      setSaveStatus('error');
    } finally {
      setCodexMcpLoading(false);
    }
  };

  const handleCodexMcpDelete = async (serverName) => {
    if (!confirm('Are you sure you want to delete this MCP server?')) {
      return;
    }

    try {
      await deleteCodexMcpServer(serverName);
      setSaveStatus('success');
    } catch (error) {
      alert(`Error: ${error.message}`);
      setSaveStatus('error');
    }
  };

  const checkCodexAuthStatus = async () => {
    try {
      const response = await authenticatedFetch('/api/cli/codex/status');
      const data = await response.json();

      if (response.ok) {
        const nextState = buildDefaultAuthState({
          ...data,
          cliCommand: data.cliCommand || 'codex',
          loading: false,
        });
        setCodexAuthStatus(nextState);
        writeCliAvailability('codex', {
          available: nextState.cliAvailable !== false,
          cliCommand: nextState.cliCommand,
          installHint: nextState.installHint || null,
          installable: nextState.installable === true,
          docsUrl: nextState.docsUrl || null,
          downloadUrl: nextState.downloadUrl || null,
        });
      } else {
        setCodexAuthStatus(buildDefaultAuthState({
          loading: false,
          cliAvailable: false,
          cliCommand: 'codex',
          error: data.error || 'Failed to check Codex status',
        }));
      }
    } catch (error) {
      setCodexAuthStatus(buildDefaultAuthState({
        loading: false,
        cliAvailable: false,
        cliCommand: 'codex',
        error: error.message || 'Failed to check Codex status',
      }));
    }
  };

  const loadWorkspaceRoot = async () => {
    try {
      const response = await api.workspaceRoot.get();
      if (!response.ok) return;
      const data = await response.json();
      setWorkspaceRoot(data.workspaceRoot || '');
      setWorkspaceRootDefault(data.defaultRoot || '');
      setWorkspaceRootError('');
      setWorkspaceRootSaved(false);
    } catch (error) {
      console.error('Error loading workspace root:', error);
    }
  };

  const saveWorkspaceRoot = async () => {
    const trimmed = workspaceRoot.trim();
    if (!trimmed) {
      setWorkspaceRootError(t('workspaceRoot.validation.required'));
      return;
    }

    try {
      setWorkspaceRootError('');
      setWorkspaceRootSaved(false);
      const response = await api.workspaceRoot.update(trimmed);
      const data = await response.json();
      if (!response.ok || !data.success) {
        setWorkspaceRootError(data.error || t('workspaceRoot.validation.saveFailed'));
        return;
      }
      setWorkspaceRootSaved(true);
      setWorkspaceRoot(trimmed);
      setTimeout(() => setWorkspaceRootSaved(false), 2500);
    } catch (error) {
      setWorkspaceRootError(error.message || t('workspaceRoot.validation.saveFailed'));
    }
  };

  const handleCodexLogin = () => {
    setSelectedProject(projects[0] || null);
    setShowLoginModal(true);
  };

  const handleLoginComplete = (exitCode) => {
    if (exitCode === 0) {
      void checkCodexAuthStatus();
    }
  };

  const saveSettings = async () => {
    setIsSaving(true);
    setSaveStatus(null);
    try {
      localStorage.setItem('codex-settings', JSON.stringify({ permissionMode: codexPermissionMode }));
      localStorage.setItem('codeEditorTheme', codeEditorTheme);
      localStorage.setItem('codeEditorWordWrap', String(codeEditorWordWrap));
      localStorage.setItem('codeEditorShowMinimap', String(codeEditorShowMinimap));
      localStorage.setItem('codeEditorLineNumbers', String(codeEditorLineNumbers));
      localStorage.setItem('codeEditorFontSize', String(codeEditorFontSize));
      setTelemetryEnabled(telemetryEnabled);
      setSaveStatus('success');
      setTimeout(() => setSaveStatus(null), 2500);
    } catch (error) {
      console.error('Error saving settings:', error);
      setSaveStatus('error');
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setActiveTab(VALID_SETTINGS_TABS.has(initialTab) ? initialTab : 'agents');
    const savedCodexSettings = localStorage.getItem('codex-settings');
    if (savedCodexSettings) {
      try {
        const parsed = JSON.parse(savedCodexSettings);
        setCodexPermissionMode(parsed.permissionMode || 'default');
      } catch {
        // Ignore invalid local settings.
      }
    }

    void checkCodexAuthStatus();
    void fetchCodexMcpServers();
    void loadWorkspaceRoot();
  }, [isOpen, initialTab]);

  useEffect(() => {
    localStorage.setItem('codeEditorTheme', codeEditorTheme);
    window.dispatchEvent(new Event('codeEditorSettingsChanged'));
  }, [codeEditorTheme]);

  useEffect(() => {
    localStorage.setItem('codeEditorWordWrap', String(codeEditorWordWrap));
    window.dispatchEvent(new Event('codeEditorSettingsChanged'));
  }, [codeEditorWordWrap]);

  useEffect(() => {
    localStorage.setItem('codeEditorShowMinimap', String(codeEditorShowMinimap));
    window.dispatchEvent(new Event('codeEditorSettingsChanged'));
  }, [codeEditorShowMinimap]);

  useEffect(() => {
    localStorage.setItem('codeEditorLineNumbers', String(codeEditorLineNumbers));
    window.dispatchEvent(new Event('codeEditorSettingsChanged'));
  }, [codeEditorLineNumbers]);

  useEffect(() => {
    localStorage.setItem('codeEditorFontSize', String(codeEditorFontSize));
    window.dispatchEvent(new Event('codeEditorSettingsChanged'));
  }, [codeEditorFontSize]);

  const categories = useMemo(() => [
    { key: 'account', label: t('agents.categories.account') },
    { key: 'permissions', label: t('agents.categories.permissions') },
    { key: 'mcp', label: t('agents.categories.mcp') },
    { key: 'memory', label: t('agents.categories.memory') },
  ], [t]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm p-0 md:p-4">
      <div className="h-full md:h-auto md:max-h-[92vh] w-full md:max-w-6xl md:mx-auto bg-background border border-border rounded-none md:rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between p-4 md:p-6 border-b border-border">
          <div className="flex items-center gap-3">
            <SettingsIcon className="w-5 h-5 md:w-6 md:h-6 text-blue-600" />
            <div>
              <h2 className="text-lg md:text-xl font-semibold text-foreground">{t('title')}</h2>
              <p className="text-xs md:text-sm text-muted-foreground">{t('subtitle')}</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        <div className="flex-1 overflow-hidden">
          <div className="border-b border-border px-4 md:px-6">
            <div className="flex gap-2 overflow-x-auto py-3">
              {[
                { key: 'agents', label: t('tabs.agents') },
                { key: 'email', label: t('tabs.email') },
                { key: 'appearance', label: t('tabs.appearance') },
                { key: 'git', label: t('tabs.git') },
                { key: 'api', label: t('tabs.api') },
              ].map((tab) => (
                <Button
                  key={tab.key}
                  variant={activeTab === tab.key ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setActiveTab(tab.key)}
                  className="whitespace-nowrap"
                >
                  {tab.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="h-[calc(100%-57px)] overflow-y-auto p-4 md:p-6">
            {activeTab === 'agents' && (
              <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6">
                <div className="space-y-4">
                  <div className="rounded-lg border border-border p-2">
                    <AgentListItem
                      agentId="codex"
                      authStatus={codexAuthStatus}
                      isSelected={true}
                      onClick={() => {}}
                    />
                  </div>

                  <div className="rounded-lg border border-border p-2">
                    {categories.map((category) => (
                      <button
                        key={category.key}
                        onClick={() => setSelectedCategory(category.key)}
                        className={`w-full text-left rounded-md px-3 py-2 text-sm transition-colors ${
                          selectedCategory === category.key
                            ? 'bg-gray-200 text-gray-900 dark:bg-gray-700 dark:text-gray-100'
                            : 'text-muted-foreground hover:bg-muted'
                        }`}
                      >
                        {category.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-6">
                  {selectedCategory === 'account' && (
                    <AccountContent
                      agent="codex"
                      authStatus={codexAuthStatus}
                      onLogin={handleCodexLogin}
                    />
                  )}

                  {selectedCategory === 'permissions' && (
                    <PermissionsContent
                      agent="codex"
                      permissionMode={codexPermissionMode}
                      setPermissionMode={setCodexPermissionMode}
                    />
                  )}

                  {selectedCategory === 'mcp' && (
                    <McpServersContent
                      agent="codex"
                      servers={codexMcpServers}
                      onAdd={() => openCodexMcpForm()}
                      onEdit={(server) => openCodexMcpForm(server)}
                      onDelete={handleCodexMcpDelete}
                    />
                  )}

                  {selectedCategory === 'memory' && <MemoryContent />}
                </div>
              </div>
            )}

            {activeTab === 'email' && <EmailSettingsContent />}

            {activeTab === 'appearance' && (
              <div className="space-y-8">
                <div>
                  <h3 className="text-lg font-medium text-foreground mb-4">{t('appearance.theme.title')}</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <button
                      onClick={toggleDarkMode}
                      className={`rounded-lg border p-4 text-left transition-colors ${
                        !isDarkMode ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-border hover:bg-muted'
                      }`}
                    >
                      <div className="flex items-center gap-2 font-medium">
                        <Sun className="w-4 h-4" />
                        {t('appearance.theme.light')}
                      </div>
                    </button>
                    <button
                      onClick={toggleDarkMode}
                      className={`rounded-lg border p-4 text-left transition-colors ${
                        isDarkMode ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-border hover:bg-muted'
                      }`}
                    >
                      <div className="flex items-center gap-2 font-medium">
                        <Moon className="w-4 h-4" />
                        {t('appearance.theme.dark')}
                      </div>
                    </button>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="text-lg font-medium text-foreground">{t('appearance.language.title')}</h3>
                  <LanguageSelector />
                </div>

                <div className="space-y-4">
                  <h3 className="text-lg font-medium text-foreground">{t('appearance.editor.title')}</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">{t('appearance.editor.theme')}</label>
                      <select
                        value={codeEditorTheme}
                        onChange={(e) => setCodeEditorTheme(e.target.value)}
                        className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      >
                        <option value="dark">Dark</option>
                        <option value="light">Light</option>
                        <option value="vs-dark">VS Dark</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">{t('appearance.editor.fontSize')}</label>
                      <Input
                        type="number"
                        min="10"
                        max="28"
                        value={codeEditorFontSize}
                        onChange={(e) => setCodeEditorFontSize(e.target.value)}
                        className="mt-1"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <label className="flex items-center gap-2 text-sm text-foreground">
                      <input type="checkbox" checked={codeEditorWordWrap} onChange={(e) => setCodeEditorWordWrap(e.target.checked)} />
                      {t('appearance.editor.wordWrap')}
                    </label>
                    <label className="flex items-center gap-2 text-sm text-foreground">
                      <input type="checkbox" checked={codeEditorShowMinimap} onChange={(e) => setCodeEditorShowMinimap(e.target.checked)} />
                      {t('appearance.editor.minimap')}
                    </label>
                    <label className="flex items-center gap-2 text-sm text-foreground">
                      <input type="checkbox" checked={codeEditorLineNumbers} onChange={(e) => setCodeEditorLineNumbers(e.target.checked)} />
                      {t('appearance.editor.lineNumbers')}
                    </label>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="text-lg font-medium text-foreground">{t('appearance.workspaceRoot.title')}</h3>
                  <p className="text-sm text-muted-foreground">{t('appearance.workspaceRoot.description')}</p>
                  <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-2">
                    <Input
                      value={workspaceRoot}
                      onChange={(e) => {
                        setWorkspaceRoot(e.target.value);
                        setWorkspaceRootSaved(false);
                        setWorkspaceRootError('');
                      }}
                      placeholder={workspaceRootDefault || t('appearance.workspaceRoot.placeholder')}
                    />
                    {isDesktop ? (
                      <Button
                        variant="outline"
                        onClick={async () => {
                          try {
                            const selectedPath = await selectDirectory(workspaceRoot || workspaceRootDefault || undefined);
                            if (selectedPath) {
                              setWorkspaceRoot(selectedPath);
                              setWorkspaceRootSaved(false);
                              setWorkspaceRootError('');
                            }
                          } catch (error) {
                            setWorkspaceRootError(error.message || t('appearance.workspaceRoot.browseError'));
                          }
                        }}
                      >
                        <FolderOpen className="w-4 h-4 mr-2" />
                        {t('appearance.workspaceRoot.browse')}
                      </Button>
                    ) : null}
                    <Button onClick={saveWorkspaceRoot}>{t('appearance.workspaceRoot.save')}</Button>
                  </div>
                  {workspaceRootSaved && (
                    <div className="text-sm text-green-600 dark:text-green-400">{t('appearance.workspaceRoot.saved')}</div>
                  )}
                  {workspaceRootError && (
                    <div className="text-sm text-red-600 dark:text-red-400">{workspaceRootError}</div>
                  )}
                  {workspaceRoot && isDesktop && (
                    <button
                      type="button"
                      onClick={() => showItemInFolder(workspaceRoot)}
                      className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                    >
                      {t('appearance.workspaceRoot.openInExplorer')}
                    </button>
                  )}
                </div>

                <div className="space-y-3">
                  <h3 className="text-lg font-medium text-foreground">Telemetry</h3>
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={telemetryEnabled}
                      onChange={(e) => setTelemetryEnabledState(e.target.checked)}
                    />
                    <span>{t('appearance.telemetry.label')}</span>
                  </label>
                </div>
              </div>
            )}

            {activeTab === 'git' && <GitSettings />}
            {activeTab === 'api' && <CredentialsSettings />}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-4 md:p-6 border-t border-border gap-3">
          <div className="flex items-center gap-2">
            {saveStatus === 'success' && (
              <div className="text-green-600 dark:text-green-400 text-sm">{t('saveStatus.success')}</div>
            )}
            {saveStatus === 'error' && (
              <div className="text-red-600 dark:text-red-400 text-sm">{t('saveStatus.error')}</div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={onClose} disabled={isSaving}>
              {t('footerActions.cancel')}
            </Button>
            <Button onClick={saveSettings} disabled={isSaving}>
              {isSaving ? t('saveStatus.saving') : t('footerActions.save')}
            </Button>
          </div>
        </div>
      </div>

      <LoginModal
        key="codex"
        isOpen={showLoginModal}
        onClose={() => setShowLoginModal(false)}
        provider="codex"
        project={selectedProject}
        onComplete={handleLoginComplete}
        isAuthenticated={codexAuthStatus.authenticated}
        cliAvailable={codexAuthStatus.cliAvailable !== false}
        installHint={codexAuthStatus.installHint}
        installable={codexAuthStatus.installable === true}
        installerAvailable={codexAuthStatus.installerAvailable !== false}
        installerHint={codexAuthStatus.installerHint}
        docsUrl={codexAuthStatus.docsUrl}
        downloadUrl={codexAuthStatus.downloadUrl}
        onStatusRefresh={checkCodexAuthStatus}
      />

      {showCodexMcpForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[110] p-4">
          <div className="bg-background border border-border rounded-lg w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h3 className="text-lg font-medium text-foreground">
                {editingCodexMcpServer ? t('mcpForm.title.edit') : t('mcpForm.title.add')}
              </h3>
              <Button variant="ghost" size="sm" onClick={resetCodexMcpForm}>
                <X className="w-4 h-4" />
              </Button>
            </div>

            <form onSubmit={handleCodexMcpSubmit} className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  {t('mcpForm.fields.serverName')} *
                </label>
                <Input
                  value={codexMcpFormData.name}
                  onChange={(e) => setCodexMcpFormData((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder={t('mcpForm.placeholders.serverName')}
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  {t('mcpForm.fields.command')} *
                </label>
                <Input
                  value={codexMcpFormData.config?.command || ''}
                  onChange={(e) => setCodexMcpFormData((prev) => ({
                    ...prev,
                    config: { ...prev.config, command: e.target.value },
                  }))}
                  placeholder="npx @my-org/mcp-server"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  {t('mcpForm.fields.arguments')}
                </label>
                <textarea
                  value={(codexMcpFormData.config?.args || []).join('\n')}
                  onChange={(e) => setCodexMcpFormData((prev) => ({
                    ...prev,
                    config: { ...prev.config, args: e.target.value.split('\n').filter((a) => a.trim()) },
                  }))}
                  placeholder="--port&#10;3000"
                  rows={3}
                  className="w-full px-3 py-2 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  {t('mcpForm.fields.envVars')}
                </label>
                <textarea
                  value={Object.entries(codexMcpFormData.config?.env || {}).map(([k, v]) => `${k}=${v}`).join('\n')}
                  onChange={(e) => {
                    const env = {};
                    e.target.value.split('\n').forEach((line) => {
                      const [key, ...valueParts] = line.split('=');
                      if (key && valueParts.length > 0) {
                        env[key.trim()] = valueParts.join('=').trim();
                      }
                    });
                    setCodexMcpFormData((prev) => ({
                      ...prev,
                      config: { ...prev.config, env },
                    }));
                  }}
                  placeholder="API_KEY=xxx&#10;DEBUG=true"
                  rows={3}
                  className="w-full px-3 py-2 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-border">
                <Button type="button" variant="outline" onClick={resetCodexMcpForm}>
                  {t('mcpForm.actions.cancel')}
                </Button>
                <Button
                  type="submit"
                  disabled={codexMcpLoading || !codexMcpFormData.name || !codexMcpFormData.config?.command}
                  className="bg-green-600 hover:bg-green-700 text-white"
                >
                  {codexMcpLoading
                    ? t('mcpForm.actions.saving')
                    : editingCodexMcpServer
                      ? t('mcpForm.actions.updateServer')
                      : t('mcpForm.actions.addServer')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Settings;

