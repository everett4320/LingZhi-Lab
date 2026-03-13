import {
  BookOpen,
  Hash,
  Loader2,
  MessageSquare,
  Newspaper,
  RefreshCw,
  Settings2,
  Zap,
} from 'lucide-react';

import { Button } from '../../ui/button';
import type { NewsSourceKey, SourceInfo } from './useNewsDashboardData';

const SOURCE_ICONS: Record<NewsSourceKey, typeof Newspaper> = {
  arxiv: BookOpen,
  huggingface: Newspaper,
  x: MessageSquare,
  xiaohongshu: Hash,
};

const SOURCE_LABELS: Record<NewsSourceKey, string> = {
  arxiv: 'arXiv',
  huggingface: 'HuggingFace',
  x: 'X',
  xiaohongshu: 'Xiaohongshu',
};

const SOURCE_INACTIVE_COLORS: Record<NewsSourceKey, string> = {
  arxiv: 'bg-rose-100/70 text-rose-800 hover:bg-rose-200/80 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:bg-rose-950/60',
  huggingface: 'bg-yellow-100/70 text-yellow-800 hover:bg-yellow-200/80 dark:bg-yellow-950/40 dark:text-yellow-300 dark:hover:bg-yellow-950/60',
  x: 'bg-gray-200/70 text-gray-800 hover:bg-gray-300/80 dark:bg-gray-800/50 dark:text-gray-300 dark:hover:bg-gray-700/60',
  xiaohongshu: 'bg-red-100/70 text-red-600 hover:bg-red-200/80 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/60',
};

const SOURCE_ACTIVE_COLORS: Record<NewsSourceKey, string> = {
  arxiv: 'bg-rose-600 text-white shadow-sm hover:bg-rose-700 dark:bg-rose-700 dark:hover:bg-rose-600',
  huggingface: 'bg-yellow-500 text-white shadow-sm hover:bg-yellow-600 dark:bg-yellow-600 dark:hover:bg-yellow-500',
  x: 'bg-gray-800 text-white shadow-sm hover:bg-gray-900 dark:bg-gray-600 dark:hover:bg-gray-500',
  xiaohongshu: 'bg-red-500 text-white shadow-sm hover:bg-red-600 dark:bg-red-600 dark:hover:bg-red-500',
};

const ALL_SOURCES: NewsSourceKey[] = ['arxiv', 'huggingface', 'x', 'xiaohongshu'];

export default function SourceFilterBar({
  activeSources,
  onToggleSource,
  sources,
  isSearching,
  onSearchAll,
  onSearchSource,
  onOpenSettings,
  isSearchingAll,
}: {
  activeSources: Set<NewsSourceKey>;
  onToggleSource: (key: NewsSourceKey) => void;
  sources: SourceInfo[];
  isSearching: Record<NewsSourceKey, boolean>;
  onSearchAll: () => void;
  onSearchSource: (key: NewsSourceKey) => void;
  onOpenSettings: (key: NewsSourceKey) => void;
  isSearchingAll: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border/60 bg-card/80 p-2 shadow-sm backdrop-blur">
      {ALL_SOURCES.map((key) => {
        const Icon = SOURCE_ICONS[key];
        const label = SOURCE_LABELS[key];
        const isActive = activeSources.has(key);
        const info = sources.find((s) => s.key === key);
        const needsCred = info?.requiresCredentials && info.credentialStatus === 'missing';
        const searching = isSearching[key];

        return (
          <div key={key} className="flex items-center gap-0.5">
            <button
              onClick={() => onToggleSource(key)}
              className={`relative flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-medium transition-all duration-200 ${
                isActive
                  ? SOURCE_ACTIVE_COLORS[key]
                  : SOURCE_INACTIVE_COLORS[key]
              }`}
            >
              <Icon className="h-4 w-4" />
              <span className="hidden sm:inline">{label}</span>
              {needsCred && (
                <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-500" title="Credential required" />
              )}
            </button>
            <button
              onClick={() => onOpenSettings(key)}
              className="rounded-lg p-1 text-muted-foreground/50 hover:text-foreground hover:bg-muted/40 transition-colors"
              title={`${label} settings`}
            >
              <Settings2 className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => onSearchSource(key)}
              disabled={searching}
              className="rounded-lg p-1 text-muted-foreground/50 hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-40"
              title={`Refresh ${label}`}
            >
              {searching ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        );
      })}

      <div className="ml-auto">
        <Button
          onClick={onSearchAll}
          disabled={isSearchingAll}
          className="h-8 gap-1.5 rounded-xl text-xs"
          size="sm"
        >
          {isSearchingAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
          Search All
        </Button>
      </div>
    </div>
  );
}
