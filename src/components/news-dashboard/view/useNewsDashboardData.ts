import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '../../../utils/api';
import type { NewsItem } from './NewsItemCard';

export type NewsSourceKey = 'arxiv' | 'huggingface' | 'x' | 'xiaohongshu';

export type SourceInfo = {
  key: NewsSourceKey;
  label: string;
  hasResults: boolean;
  lastSearchDate: string | null;
  requiresCredentials: boolean;
  credentialType: string | null;
  credentialStatus: 'not_required' | 'configured' | 'missing';
};

export type SearchResults = {
  top_papers: NewsItem[];
  total_found: number;
  total_filtered: number;
  search_date?: string;
};

export type ResearchDomain = {
  keywords: string[];
  arxiv_categories: string[];
  priority: number;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SourceConfig = Record<string, any>;

const ALL_SOURCES: NewsSourceKey[] = ['arxiv', 'huggingface', 'x', 'xiaohongshu'];

export function useNewsDashboardData() {
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [configs, setConfigs] = useState<Record<NewsSourceKey, SourceConfig>>({} as Record<NewsSourceKey, SourceConfig>);
  const [results, setResults] = useState<Record<NewsSourceKey, SearchResults>>({} as Record<NewsSourceKey, SearchResults>);
  const [isSearching, setIsSearching] = useState<Record<NewsSourceKey, boolean>>({} as Record<NewsSourceKey, boolean>);
  const [errors, setErrors] = useState<Record<NewsSourceKey, string | null>>({} as Record<NewsSourceKey, string | null>);
  const [configDirty, setConfigDirty] = useState<Record<NewsSourceKey, boolean>>({} as Record<NewsSourceKey, boolean>);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch all data on mount
  useEffect(() => {
    async function load() {
      try {
        const sourcesRes = await api.news.getSources().then((r) => r.json());
        setSources(sourcesRes.sources || []);

        const configPromises = ALL_SOURCES.map((key) =>
          api.news.getConfig(key).then((r) => r.json()).catch(() => ({}))
        );
        const resultPromises = ALL_SOURCES.map((key) =>
          api.news.getResults(key).then((r) => r.json()).catch(() => ({ top_papers: [], total_found: 0, total_filtered: 0 }))
        );

        const [cfgs, ress] = await Promise.all([
          Promise.all(configPromises),
          Promise.all(resultPromises),
        ]);

        const newConfigs = {} as Record<NewsSourceKey, SourceConfig>;
        const newResults = {} as Record<NewsSourceKey, SearchResults>;
        ALL_SOURCES.forEach((key, i) => {
          newConfigs[key] = cfgs[i];
          newResults[key] = ress[i];
        });
        setConfigs(newConfigs);
        setResults(newResults);
      } catch (err) {
        console.error('Failed to load news dashboard data:', err);
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, []);

  // Poll intermediate results while any source is searching
  const isSearchingRef = useRef(isSearching);
  isSearchingRef.current = isSearching;

  useEffect(() => {
    const searchingKeys = ALL_SOURCES.filter((k) => isSearching[k]);
    if (searchingKeys.length === 0) return;

    const interval = setInterval(async () => {
      const currentSearching = ALL_SOURCES.filter((k) => isSearchingRef.current[k]);
      if (currentSearching.length === 0) return;

      await Promise.allSettled(
        currentSearching.map(async (key) => {
          try {
            const res = await api.news.getResults(key);
            if (!res.ok) return;
            const data = await res.json();
            if (data?.top_papers?.length > 0) {
              setResults((prev) => ({ ...prev, [key]: data }));
            }
          } catch {
            // ignore polling errors
          }
        })
      );
    }, 3000);

    return () => clearInterval(interval);
  }, [isSearching]);

  const searchSource = useCallback(async (key: NewsSourceKey) => {
    setIsSearching((prev) => ({ ...prev, [key]: true }));
    setErrors((prev) => ({ ...prev, [key]: null }));
    try {
      // Save config if dirty
      if (configDirty[key] && configs[key]) {
        await api.news.updateConfig(key, configs[key]);
        setConfigDirty((prev) => ({ ...prev, [key]: false }));
      }
      const res = await api.news.search(key);
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Search failed');
      }
      const data = await res.json();
      setResults((prev) => ({ ...prev, [key]: data }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Search failed';
      setErrors((prev) => ({ ...prev, [key]: message }));
    } finally {
      setIsSearching((prev) => ({ ...prev, [key]: false }));
    }
  }, [configs, configDirty]);

  const searchAll = useCallback(async (activeKeys: NewsSourceKey[]) => {
    await Promise.allSettled(activeKeys.map((key) => searchSource(key)));
  }, [searchSource]);

  const updateConfig = useCallback((key: NewsSourceKey, config: SourceConfig) => {
    setConfigs((prev) => ({ ...prev, [key]: config }));
    setConfigDirty((prev) => ({ ...prev, [key]: true }));
  }, []);

  const saveConfig = useCallback(async (key: NewsSourceKey) => {
    if (!configs[key]) return;
    try {
      await api.news.updateConfig(key, configs[key]);
      setConfigDirty((prev) => ({ ...prev, [key]: false }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save config';
      setErrors((prev) => ({ ...prev, [key]: message }));
    }
  }, [configs]);

  const clearError = useCallback((key: NewsSourceKey) => {
    setErrors((prev) => ({ ...prev, [key]: null }));
  }, []);

  return {
    sources,
    configs,
    results,
    isSearching,
    errors,
    configDirty,
    isLoading,
    searchSource,
    searchAll,
    updateConfig,
    saveConfig,
    clearError,
  };
}
