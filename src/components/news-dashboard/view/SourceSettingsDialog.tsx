import {
  Key,
  Loader2,
  Plus,
  Settings2,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useState } from 'react';

import { Button } from '../../ui/button';
import type { NewsSourceKey, ResearchDomain, SourceInfo } from './useNewsDashboardData';

const ARXIV_CATEGORIES = [
  'cs.AI', 'cs.LG', 'cs.CL', 'cs.CV', 'cs.MM', 'cs.MA', 'cs.RO',
  'cs.IR', 'cs.NE', 'cs.SE', 'stat.ML', 'eess.AS', 'eess.IV',
];

const SOURCE_TITLES: Record<NewsSourceKey, string> = {
  arxiv: 'arXiv Settings',
  huggingface: 'HuggingFace Settings',
  x: 'X (Twitter) Settings',
  xiaohongshu: 'Xiaohongshu Settings',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyConfig = Record<string, any>;

function DomainEditor({
  name,
  domain,
  onUpdate,
  onRemove,
  showCategories,
}: {
  name: string;
  domain: ResearchDomain;
  onUpdate: (name: string, domain: ResearchDomain) => void;
  onRemove: (name: string) => void;
  showCategories?: boolean;
}) {
  const [keywordInput, setKeywordInput] = useState('');
  const [catInput, setCatInput] = useState('');

  const addKeyword = () => {
    const kw = keywordInput.trim();
    if (kw && !domain.keywords.includes(kw)) {
      onUpdate(name, { ...domain, keywords: [...domain.keywords, kw] });
      setKeywordInput('');
    }
  };

  const removeKeyword = (kw: string) => {
    onUpdate(name, { ...domain, keywords: domain.keywords.filter((k) => k !== kw) });
  };

  return (
    <div className="rounded-2xl border border-border/50 bg-background/60 p-4 space-y-3 transition-colors hover:border-border/80">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground">{name}</h4>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <label className="text-[10px] font-medium text-muted-foreground">Priority</label>
            <input
              type="number" min={1} max={10}
              value={domain.priority}
              onChange={(e) => onUpdate(name, { ...domain, priority: parseInt(e.target.value) || 5 })}
              className="w-12 rounded-lg border border-border/60 bg-background px-2 py-1 text-xs text-center font-medium tabular-nums"
            />
          </div>
          <button onClick={() => onRemove(name)} className="rounded-lg p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div>
        <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">Keywords</label>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {domain.keywords.map((kw) => (
            <span key={kw} className="inline-flex items-center gap-1 rounded-lg border border-sky-200/60 bg-sky-50/80 px-2 py-0.5 text-[10px] font-medium text-sky-700 dark:border-sky-800/40 dark:bg-sky-950/30 dark:text-sky-300">
              {kw}
              <button onClick={() => removeKeyword(kw)} className="text-sky-400 hover:text-destructive transition-colors">&times;</button>
            </span>
          ))}
          <div className="inline-flex items-center gap-1">
            <input
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addKeyword()}
              placeholder="Add..."
              className="w-20 rounded-lg border border-dashed border-border/60 bg-transparent px-2 py-0.5 text-[10px] placeholder:text-muted-foreground/40 focus:border-primary/40 focus:outline-none"
            />
            <button onClick={addKeyword} className="rounded p-0.5 text-primary/60 hover:text-primary transition-colors"><Plus className="h-3 w-3" /></button>
          </div>
        </div>
      </div>

      {showCategories && (
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">arXiv Categories</label>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {domain.arxiv_categories.map((cat) => (
              <span key={cat} className="inline-flex items-center gap-1 rounded-lg border border-emerald-200/60 bg-emerald-50/80 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-950/30 dark:text-emerald-300">
                {cat}
                <button onClick={() => onUpdate(name, { ...domain, arxiv_categories: domain.arxiv_categories.filter((c) => c !== cat) })} className="text-emerald-400 hover:text-destructive transition-colors">&times;</button>
              </span>
            ))}
            <select
              value={catInput}
              onChange={(e) => {
                const cat = e.target.value;
                if (cat && !domain.arxiv_categories.includes(cat)) {
                  onUpdate(name, { ...domain, arxiv_categories: [...domain.arxiv_categories, cat] });
                }
                setCatInput('');
              }}
              className="rounded-lg border border-dashed border-border/60 bg-transparent px-2 py-0.5 text-[10px] text-muted-foreground/70 focus:border-primary/40 focus:outline-none"
            >
              <option value="">Add...</option>
              {ARXIV_CATEGORIES.filter((c) => !domain.arxiv_categories.includes(c)).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}

function CredentialSection({ credentialStatus, credentialType, label, placeholder, description }: {
  credentialStatus: string;
  credentialType: string;
  label: string;
  placeholder: string;
  description: string;
}) {
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const credentialNames: Record<string, string> = {
    x_bearer_token: 'X Bearer Token',
    xiaohongshu_token: 'Xiaohongshu Cookie',
  };
  const credentialDescriptions: Record<string, string> = {
    x_bearer_token: 'Bearer token for X (Twitter) API v2',
    xiaohongshu_token: 'Cookie token for Xiaohongshu web API (expires every 7-30 days)',
  };

  const handleSave = async () => {
    if (!token.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch('/api/settings/credentials', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('auth-token')}`,
        },
        body: JSON.stringify({
          credentialName: credentialNames[credentialType] || label,
          credentialType,
          credentialValue: token.trim(),
          description: credentialDescriptions[credentialType] || description,
        }),
      });
      if (!res.ok) throw new Error('Failed to save');
      setToken('');
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border/50 bg-background/60 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Key className="h-4 w-4 text-muted-foreground" />
        <h4 className="text-sm font-semibold text-foreground">{label}</h4>
        {credentialStatus === 'configured' && (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">Configured</span>
        )}
        {credentialStatus === 'missing' && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">Not set</span>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">{description}</p>
      <div className="flex items-center gap-2">
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={placeholder}
          className="flex-1 rounded-lg border border-border/60 bg-background px-3 py-2 text-xs font-mono focus:border-primary/40 focus:outline-none"
        />
        <Button size="sm" onClick={handleSave} disabled={saving || !token.trim()} className="rounded-lg text-xs">
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : saved ? 'Saved!' : 'Save'}
        </Button>
      </div>
      {saveError && <p className="text-[10px] text-red-500">{saveError}</p>}
    </div>
  );
}

export default function SourceSettingsDialog({
  sourceKey,
  config,
  onConfigChange,
  onSave,
  onClose,
  sourceInfo,
  configDirty,
}: {
  sourceKey: NewsSourceKey;
  config: AnyConfig;
  onConfigChange: (config: AnyConfig) => void;
  onSave: () => void;
  onClose: () => void;
  sourceInfo?: SourceInfo;
  configDirty: boolean;
}) {
  const [newDomainName, setNewDomainName] = useState('');

  const credentialStatus = sourceInfo?.credentialStatus ?? 'not_required';

  const updateField = useCallback((field: string, value: unknown) => {
    onConfigChange({ ...config, [field]: value });
  }, [config, onConfigChange]);

  const updateDomain = useCallback((name: string, domain: ResearchDomain) => {
    onConfigChange({ ...config, research_domains: { ...config.research_domains, [name]: domain } });
  }, [config, onConfigChange]);

  const removeDomain = useCallback((name: string) => {
    const { [name]: _, ...rest } = config.research_domains;
    onConfigChange({ ...config, research_domains: rest });
  }, [config, onConfigChange]);

  const addDomain = useCallback(() => {
    if (!newDomainName.trim()) return;
    onConfigChange({
      ...config,
      research_domains: {
        ...config.research_domains,
        [newDomainName.trim()]: { keywords: [], arxiv_categories: sourceKey === 'arxiv' ? ['cs.AI'] : [], priority: 5 },
      },
    });
    setNewDomainName('');
  }, [config, newDomainName, onConfigChange, sourceKey]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-[28px] border border-border/60 bg-card p-6 shadow-2xl space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10">
              <Settings2 className="h-4 w-4 text-primary" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">{SOURCE_TITLES[sourceKey]}</h3>
          </div>
          <div className="flex items-center gap-2">
            {configDirty && (
              <Button size="sm" className="rounded-full text-xs gap-1.5 shadow-sm" onClick={onSave}>
                Save Changes
              </Button>
            )}
            <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Credentials for X and Xiaohongshu */}
        {sourceKey === 'x' && (
          <CredentialSection
            credentialStatus={credentialStatus}
            credentialType="x_bearer_token"
            label="X API Bearer Token"
            placeholder="Enter Bearer Token..."
            description="Required for searching X/Twitter. Get a Bearer Token from the X Developer Portal."
          />
        )}
        {sourceKey === 'xiaohongshu' && (
          <CredentialSection
            credentialStatus={credentialStatus}
            credentialType="xiaohongshu_token"
            label="Xiaohongshu Cookie Token"
            placeholder="Paste cookie string..."
            description="Required for searching Xiaohongshu. Copy your browser cookie from xiaohongshu.com. Cookies expire every 7-30 days."
          />
        )}

        {/* Source-specific fields */}
        {sourceKey === 'x' && (
          <>
            <div className="rounded-xl border border-border/40 bg-background/50 p-3.5">
              <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">Search Queries (comma-separated)</label>
              <input
                value={config.queries || ''}
                onChange={(e) => updateField('queries', e.target.value)}
                placeholder="LLM, AI agents, foundation model..."
                className="mt-1.5 w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/20"
              />
            </div>
            <div className="rounded-xl border border-border/40 bg-background/50 p-3.5">
              <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">Tracked Accounts (comma-separated handles)</label>
              <input
                value={config.accounts || ''}
                onChange={(e) => updateField('accounts', e.target.value)}
                placeholder="@kaboroevich, @_jasonwei, @ylaboratory..."
                className="mt-1.5 w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/20"
              />
            </div>
          </>
        )}

        {sourceKey === 'xiaohongshu' && (
          <div className="rounded-xl border border-border/40 bg-background/50 p-3.5">
            <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">Search Keywords (comma-separated)</label>
            <input
              value={config.keywords || ''}
              onChange={(e) => updateField('keywords', e.target.value)}
              placeholder="大模型, AI论文, 人工智能..."
              className="mt-1.5 w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/20"
            />
          </div>
        )}

        {/* Common fields */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-border/40 bg-background/50 p-3.5">
            <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">Results to show</label>
            <input
              type="number" min={1} max={50}
              value={config.top_n || 10}
              onChange={(e) => updateField('top_n', parseInt(e.target.value) || 10)}
              className="mt-1.5 w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm font-medium tabular-nums focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/20"
            />
          </div>
          {sourceKey === 'arxiv' && (
            <div className="rounded-xl border border-border/40 bg-background/50 p-3.5">
              <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">Max arXiv results to scan</label>
              <input
                type="number" min={50} max={1000} step={50}
                value={config.max_results || 200}
                onChange={(e) => updateField('max_results', parseInt(e.target.value) || 200)}
                className="mt-1.5 w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm font-medium tabular-nums focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/20"
              />
            </div>
          )}
        </div>

        {/* Research Domains */}
        <div className="space-y-3">
          <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">Research Domains</label>
          {Object.entries(config.research_domains || {}).map(([name, domain]) => (
            <DomainEditor
              key={name}
              name={name}
              domain={domain as ResearchDomain}
              onUpdate={updateDomain}
              onRemove={removeDomain}
              showCategories={sourceKey === 'arxiv'}
            />
          ))}
          <div className="flex items-center gap-2">
            <input
              value={newDomainName}
              onChange={(e) => setNewDomainName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addDomain()}
              placeholder="New domain name..."
              className="flex-1 rounded-xl border border-dashed border-border/60 bg-transparent px-3.5 py-2 text-sm placeholder:text-muted-foreground/40 focus:border-primary/40 focus:outline-none"
            />
            <Button size="sm" variant="outline" className="rounded-full gap-1.5" onClick={addDomain} disabled={!newDomainName.trim()}>
              <Plus className="h-3.5 w-3.5" /> Add Domain
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
