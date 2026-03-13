import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Hash,
  Loader2,
  MessageSquare,
  Newspaper,
  Search,
  Settings2,
} from 'lucide-react';
import { useState } from 'react';

import NewsItemCard from './NewsItemCard';
import type { NewsSourceKey, SearchResults } from './useNewsDashboardData';

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

const SOURCE_BORDER_COLORS: Record<NewsSourceKey, string> = {
  arxiv: 'border-rose-200/60 dark:border-rose-800/40',
  huggingface: 'border-yellow-200/60 dark:border-yellow-800/40',
  x: 'border-gray-300/60 dark:border-gray-700/40',
  xiaohongshu: 'border-red-200/60 dark:border-red-800/40',
};

const SOURCE_HEADER_COLORS: Record<NewsSourceKey, string> = {
  arxiv: 'text-rose-700 dark:text-rose-300',
  huggingface: 'text-yellow-700 dark:text-yellow-300',
  x: 'text-gray-700 dark:text-gray-300',
  xiaohongshu: 'text-red-600 dark:text-red-300',
};

const SOURCE_BADGE_COLORS: Record<NewsSourceKey, string> = {
  arxiv: 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
  huggingface: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-300',
  x: 'bg-gray-200 text-gray-700 dark:bg-gray-800/50 dark:text-gray-300',
  xiaohongshu: 'bg-red-100 text-red-600 dark:bg-red-950/40 dark:text-red-300',
};

const ALL_SOURCES: NewsSourceKey[] = ['arxiv', 'huggingface', 'x', 'xiaohongshu'];

export default function UnifiedFeed({
  activeSources,
  results,
  errors,
  isSearching,
  onSearchSource,
  onOpenSettings,
}: {
  activeSources: Set<NewsSourceKey>;
  results: Record<NewsSourceKey, SearchResults>;
  errors: Record<NewsSourceKey, string | null>;
  isSearching: Record<NewsSourceKey, boolean>;
  onSearchSource: (key: NewsSourceKey) => void;
  onOpenSettings: (key: NewsSourceKey) => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggleCollapse = (key: NewsSourceKey) => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const activeSourceKeys = ALL_SOURCES.filter((k) => activeSources.has(k));

  if (activeSourceKeys.length === 0) {
    return (
      <div className="rounded-[28px] border border-border/60 bg-card/70 p-10 text-center">
        <p className="text-sm text-muted-foreground">No active sources selected. Toggle sources above to see results.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {activeSourceKeys.map((key) => {
        const Icon = SOURCE_ICONS[key];
        const label = SOURCE_LABELS[key];
        const papers = results[key]?.top_papers ?? [];
        const error = errors[key];
        const searching = isSearching[key];
        const totalFound = results[key]?.total_found ?? 0;
        const isCollapsed = collapsed[key] ?? false;

        return (
          <section
            key={key}
            className={`rounded-[28px] border ${SOURCE_BORDER_COLORS[key]} bg-card/80 shadow-sm backdrop-blur overflow-hidden`}
          >
            {/* Source header — clickable to toggle */}
            <button
              type="button"
              onClick={() => toggleCollapse(key)}
              className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left hover:bg-muted/20 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                {isCollapsed ? (
                  <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                )}
                <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${SOURCE_BADGE_COLORS[key]}`}>
                  <Icon className="h-4.5 w-4.5" />
                </div>
                <div className="min-w-0">
                  <h3 className={`text-sm font-semibold ${SOURCE_HEADER_COLORS[key]}`}>{label}</h3>
                  <p className="text-[11px] text-muted-foreground">
                    {papers.length > 0
                      ? `${papers.length} results${totalFound > 0 ? ` from ${totalFound} scanned` : ''}`
                      : 'No results yet'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                {searching && (
                  <div className="flex items-center gap-1.5 rounded-lg bg-primary/5 px-2.5 py-1 text-xs text-primary dark:bg-primary/10">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Searching...
                  </div>
                )}
                <button
                  onClick={() => onOpenSettings(key)}
                  className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                  title={`${label} settings`}
                >
                  <Settings2 className="h-4 w-4" />
                </button>
                <button
                  onClick={() => onSearchSource(key)}
                  disabled={searching}
                  className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-40"
                  title={`Refresh ${label}`}
                >
                  <Search className="h-4 w-4" />
                </button>
              </div>
            </button>

            {/* Collapsible content */}
            {!isCollapsed && (
              <>
                {/* Error */}
                {error && (
                  <div className="mx-5 mb-4 flex items-center gap-3 rounded-xl border border-red-200/80 bg-red-50/80 p-3 text-xs text-red-700 dark:border-red-800/50 dark:bg-red-950/30 dark:text-red-300">
                    <span>{error}</span>
                  </div>
                )}

                {/* Results grid */}
                {papers.length > 0 ? (
                  <div className="max-h-[1000px] overflow-y-auto grid gap-4 grid-cols-1 xl:grid-cols-2 p-5 pt-0">
                    {papers.map((item, index) => (
                      <NewsItemCard key={item.id} item={item} index={index} sourceKey={key} />
                    ))}
                  </div>
                ) : !searching && !error ? (
                  <div className="flex items-center justify-center gap-3 px-5 py-8 text-sm text-muted-foreground">
                    <Icon className="h-4 w-4" />
                    <span>No results yet</span>
                    <button
                      onClick={() => onSearchSource(key)}
                      className="flex items-center gap-1 rounded-lg border border-border/50 px-2.5 py-1 text-xs font-medium hover:bg-muted/40 transition-colors"
                    >
                      <Search className="h-3 w-3" /> Search
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}
