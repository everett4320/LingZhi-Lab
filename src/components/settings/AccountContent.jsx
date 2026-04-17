import { useState } from 'react';
import { LogIn, Key } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { authenticatedFetch } from '../../utils/api';
import SessionProviderLogo from '../SessionProviderLogo';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

const codexConfig = {
  name: 'Codex',
  description: 'OpenAI Codex AI assistant',
  cliCommand: 'codex',
  bgClass: 'bg-gray-100 dark:bg-gray-800/50',
  borderClass: 'border-gray-300 dark:border-gray-600',
  textClass: 'text-gray-900 dark:text-gray-100',
  subtextClass: 'text-gray-700 dark:text-gray-300',
  buttonClass: 'bg-gray-800 hover:bg-gray-900 dark:bg-gray-700 dark:hover:bg-gray-600',
};

export default function AccountContent({ agent, authStatus, onLogin }) {
  const { t } = useTranslation('settings');
  const cliMissing = authStatus?.cliAvailable === false;
  const installHint = authStatus?.installHint;

  const [openaiApiKey, setOpenaiApiKey] = useState('');
  const [isVerifyingOpenAI, setIsVerifyingOpenAI] = useState(false);
  const [openaiVerifyResult, setOpenaiVerifyResult] = useState(null);

  const handleVerifyOpenAIKey = async () => {
    setIsVerifyingOpenAI(true);
    setOpenaiVerifyResult(null);
    try {
      const res = await authenticatedFetch('/api/cli/codex/verify-api-key', {
        method: 'POST',
        body: JSON.stringify({ apiKey: openaiApiKey.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setOpenaiVerifyResult({ success: true, message: data.message || 'API key verified and saved.' });
        setOpenaiApiKey('');
      } else {
        setOpenaiVerifyResult({ success: false, message: data.error || 'Invalid API key' });
      }
    } catch (err) {
      setOpenaiVerifyResult({ success: false, message: err.message });
    } finally {
      setIsVerifyingOpenAI(false);
    }
  };

  // Codex-only runtime: if a non-codex agent id leaks in, keep UI safe and render codex panel.
  const resolvedAgent = agent === 'codex' ? agent : 'codex';

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-4">
        <SessionProviderLogo provider={resolvedAgent} className="w-6 h-6" />
        <div>
          <h3 className="text-lg font-medium text-foreground">{codexConfig.name}</h3>
          <p className="text-sm text-muted-foreground">{t('agents.account.codex.description')}</p>
        </div>
      </div>

      <div className={`${codexConfig.bgClass} border ${codexConfig.borderClass} rounded-lg p-4`}>
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <div className={`font-medium ${codexConfig.textClass}`}>{t('agents.connectionStatus')}</div>
              <div className={`text-sm ${codexConfig.subtextClass}`}>
                {authStatus?.loading ? (
                  t('agents.authStatus.checkingAuth')
                ) : cliMissing ? (
                  t('agents.authStatus.cliMissing', { command: authStatus?.cliCommand || codexConfig.cliCommand })
                ) : authStatus?.authenticated ? (
                  t('agents.authStatus.loggedInAs', { email: authStatus.email || t('agents.authStatus.authenticatedUser') })
                ) : (
                  t('agents.authStatus.notConnected')
                )}
              </div>
            </div>
            <div>
              {authStatus?.loading ? (
                <Badge variant="secondary" className="bg-gray-100 dark:bg-gray-800">
                  {t('agents.authStatus.checking')}
                </Badge>
              ) : cliMissing ? (
                <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                  {t('agents.authStatus.installRequired')}
                </Badge>
              ) : authStatus?.authenticated ? (
                <Badge variant="success" className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                  {t('agents.authStatus.connected')}
                </Badge>
              ) : (
                <Badge variant="secondary" className="bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300">
                  {t('agents.authStatus.disconnected')}
                </Badge>
              )}
            </div>
          </div>

          <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
            <div className="flex items-center justify-between">
              <div>
                <div className={`font-medium ${codexConfig.textClass}`}>
                  {authStatus?.authenticated ? t('agents.login.reAuthenticate') : t('agents.login.title')}
                </div>
                <div className={`text-sm ${codexConfig.subtextClass}`}>
                  {authStatus?.authenticated
                    ? t('agents.login.reAuthDescription')
                    : cliMissing
                      ? t('agents.login.installDescription', { agent: codexConfig.name })
                      : t('agents.login.description', { agent: codexConfig.name })}
                </div>
              </div>
              <Button
                onClick={onLogin}
                className={`${codexConfig.buttonClass} text-white`}
                size="sm"
                disabled={authStatus?.loading || cliMissing}
              >
                <LogIn className="w-4 h-4 mr-2" />
                {authStatus?.authenticated ? t('agents.login.reLoginButton') : t('agents.login.button')}
              </Button>
            </div>
          </div>

          {cliMissing && installHint && (
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
                <div className="font-medium">{t('agents.install.title')}</div>
                <div className="mt-1">{installHint}</div>
                <div className="mt-2 font-mono text-xs">{authStatus?.cliCommand || codexConfig.cliCommand}</div>
              </div>
            </div>
          )}

          <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
            <div className="flex items-center gap-2 mb-3">
              <Key className="w-4 h-4 text-gray-500" />
              <div className={`font-medium ${codexConfig.textClass}`}>OpenAI API Key</div>
            </div>
            <p className={`text-sm ${codexConfig.subtextClass} mb-3`}>
              {authStatus?.hasApiKey
                ? 'Your API key is configured. Enter a new key below to replace it.'
                : 'Optional: Add an API key for direct REST API access.'}
            </p>
            <div className="space-y-3">
              <div>
                <label className="text-sm text-gray-600 dark:text-gray-400 block mb-1 flex items-center gap-1">
                  <Key className="w-3.5 h-3.5" /> API Key
                </label>
                <Input
                  type="password"
                  placeholder="sk-proj-..."
                  value={openaiApiKey}
                  onChange={(e) => setOpenaiApiKey(e.target.value)}
                />
              </div>
              <Button
                onClick={handleVerifyOpenAIKey}
                disabled={isVerifyingOpenAI || !openaiApiKey.trim()}
                size="sm"
                className={`${codexConfig.buttonClass} text-white w-full`}
              >
                {isVerifyingOpenAI ? 'Verifying...' : 'Verify & Save Key'}
              </Button>
              {openaiVerifyResult && (
                <div className={`text-sm ${openaiVerifyResult.success ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                  {openaiVerifyResult.message}
                </div>
              )}
            </div>
          </div>

          {authStatus?.error && !cliMissing && (
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
              <div className="text-sm text-red-600 dark:text-red-400">{t('agents.error', { error: authStatus.error })}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
