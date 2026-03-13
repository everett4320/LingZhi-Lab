import {
  ExternalLink,
  Star,
  Clock,
  ChevronDown,
  ChevronUp,
  Heart,
  Repeat2,
  MessageCircle,
  Bookmark,
} from 'lucide-react';
import { useState } from 'react';

import type { NewsSourceKey } from './useNewsDashboardData';

export type NewsItem = {
  id: string;
  title: string;
  authors: string;
  abstract: string;
  published: string;
  categories: string[];
  relevance_score: number;
  recency_score: number;
  popularity_score: number;
  quality_score: number;
  final_score: number;
  matched_domain: string;
  matched_keywords: string[];
  link?: string;
  pdf_link?: string;
  source?: string;
  // Social-specific fields
  engagement?: { likes?: number; retweets?: number; reposts?: number; replies?: number; comments?: number; collects?: number; impressions?: number };
  avatar_url?: string;
  media_urls?: string[];
};

const SCORE_COLORS = [
  { label: 'Relevance', key: 'relevance_score' as const, bar: 'bg-gradient-to-r from-sky-400 to-sky-500', dot: 'bg-sky-500' },
  { label: 'Recency', key: 'recency_score' as const, bar: 'bg-gradient-to-r from-emerald-400 to-emerald-500', dot: 'bg-emerald-500' },
  { label: 'Popularity', key: 'popularity_score' as const, bar: 'bg-gradient-to-r from-amber-400 to-amber-500', dot: 'bg-amber-500' },
  { label: 'Quality', key: 'quality_score' as const, bar: 'bg-gradient-to-r from-violet-400 to-violet-500', dot: 'bg-violet-500' },
];

function ScoreBar({ label, score, max = 3, barClass, dotClass }: { label: string; score: number; max?: number; barClass: string; dotClass: string }) {
  const pct = Math.min(100, (score / max) * 100);
  return (
    <div className="flex items-center gap-2.5 text-xs">
      <span className="flex items-center gap-1.5 w-[5.5rem] text-muted-foreground">
        <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
        {label}
      </span>
      <div className="flex-1 h-[5px] bg-muted/50 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${barClass}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-7 text-right font-medium tabular-nums text-foreground/70">{score.toFixed(1)}</span>
    </div>
  );
}

function EngagementBadges({ engagement }: { engagement: NewsItem['engagement'] }) {
  if (!engagement) return null;
  const items: { icon: typeof Heart; value: number; label: string }[] = [];
  if (engagement.likes != null) items.push({ icon: Heart, value: engagement.likes, label: 'likes' });
  if (engagement.retweets != null) items.push({ icon: Repeat2, value: engagement.retweets, label: 'retweets' });
  if (engagement.reposts != null) items.push({ icon: Repeat2, value: engagement.reposts, label: 'reposts' });
  if (engagement.comments != null) items.push({ icon: MessageCircle, value: engagement.comments, label: 'comments' });
  if (engagement.replies != null) items.push({ icon: MessageCircle, value: engagement.replies, label: 'replies' });
  if (engagement.collects != null) items.push({ icon: Bookmark, value: engagement.collects, label: 'collects' });
  if (items.length === 0) return null;

  return (
    <div className="flex items-center gap-3 mt-2">
      {items.map(({ icon: Icon, value, label }) => (
        <span key={label} className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Icon className="h-3 w-3" /> {value}
        </span>
      ))}
    </div>
  );
}

export default function NewsItemCard({ item, index, sourceKey }: { item: NewsItem; index: number; sourceKey: NewsSourceKey }) {
  const [expanded, setExpanded] = useState(false);

  const isTopItem = index < 3;
  const borderAccent = isTopItem ? 'border-amber-200/80 dark:border-amber-800/50' : 'border-border/60';

  // Build links based on source
  const primaryUrl = item.link || (sourceKey === 'arxiv' ? `https://arxiv.org/abs/${item.id}` : '#');
  const pdfUrl = item.pdf_link || (sourceKey === 'arxiv' ? `https://arxiv.org/pdf/${item.id}` : null);

  const sourceBadgeLabel = sourceKey === 'arxiv' ? 'arXiv'
    : sourceKey === 'huggingface' ? 'HF'
    : sourceKey === 'x' ? 'X'
    : 'XHS';

  return (
    <article className={`group relative overflow-hidden rounded-[22px] border ${borderAccent} bg-card/85 shadow-sm backdrop-blur transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg`}>
      {isTopItem ? (
        <div className="h-[3px] bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500" />
      ) : (
        <div className="h-[2px] bg-gradient-to-r from-amber-500/40 via-orange-500/40 to-rose-500/40" />
      )}

      <div className="p-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            {item.avatar_url ? (
              <img src={item.avatar_url} alt="" className="h-8 w-8 rounded-xl object-cover" />
            ) : (
              <span className={`flex h-8 w-8 items-center justify-center rounded-xl text-xs font-bold ${
                isTopItem
                  ? 'bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-sm'
                  : 'bg-muted/80 text-muted-foreground'
              }`}>
                {index + 1}
              </span>
            )}
            <div className="flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-1 dark:bg-amber-950/30">
              <Star className="h-3 w-3 text-amber-500" fill="currentColor" />
              <span className="text-xs font-bold tabular-nums text-amber-700 dark:text-amber-300">{item.final_score?.toFixed(1) ?? '—'}</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <a href={primaryUrl} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-lg border border-border/50 bg-background/80 px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:border-border transition-colors">
              {sourceBadgeLabel} <ExternalLink className="h-2.5 w-2.5" />
            </a>
            {pdfUrl && (
              <a href={pdfUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-lg border border-border/50 bg-background/80 px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:border-border transition-colors">
                PDF <ExternalLink className="h-2.5 w-2.5" />
              </a>
            )}
          </div>
        </div>

        {/* Title */}
        <h3 className="mt-3.5 text-[15px] font-semibold leading-snug text-foreground tracking-tight">{item.title}</h3>

        {/* Authors */}
        <p className="mt-1.5 text-xs text-muted-foreground/80 line-clamp-1">{item.authors}</p>

        {/* Engagement badges for social sources */}
        <EngagementBadges engagement={item.engagement} />

        {/* Tags */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {item.matched_domain && (
            <span className="rounded-lg border border-amber-200/80 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:border-amber-800/50 dark:bg-amber-950/40 dark:text-amber-300">
              {item.matched_domain}
            </span>
          )}
          {item.categories?.slice(0, 3).map((cat) => (
            <span key={cat} className="rounded-lg border border-border/40 bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {cat}
            </span>
          ))}
          {item.published && (
            <span className="flex items-center gap-1 rounded-lg border border-border/40 bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              <Clock className="h-2.5 w-2.5" />
              {item.published.slice(0, 10)}
            </span>
          )}
        </div>

        {/* Expand toggle */}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-3.5 flex items-center gap-1.5 text-xs font-medium text-primary/80 hover:text-primary transition-colors"
        >
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          {expanded ? 'Collapse' : 'Details & score breakdown'}
        </button>

        {/* Expanded content */}
        {expanded && (
          <div className="mt-3.5 space-y-4 rounded-xl bg-muted/20 p-4 border border-border/30">
            <p className="text-xs leading-[1.7] text-muted-foreground">{item.abstract}</p>

            {/* Media images for social sources */}
            {item.media_urls && item.media_urls.length > 0 && (
              <div className="flex gap-2 overflow-x-auto">
                {item.media_urls.slice(0, 4).map((url, i) => (
                  <img key={i} src={url} alt="" className="h-24 w-24 rounded-lg object-cover border border-border/30" />
                ))}
              </div>
            )}

            <div className="space-y-2">
              <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/70 mb-2">Score Breakdown</div>
              {SCORE_COLORS.map(({ label, key, bar, dot }) => (
                <ScoreBar key={key} label={label} score={item[key] ?? 0} barClass={bar} dotClass={dot} />
              ))}
            </div>

            {item.matched_keywords?.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] font-medium text-muted-foreground/70 mr-0.5">Matched keywords:</span>
                {item.matched_keywords.map((kw) => (
                  <span key={kw} className="rounded-md bg-primary/8 px-2 py-0.5 text-[10px] font-medium text-primary/80 border border-primary/10">{kw}</span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
