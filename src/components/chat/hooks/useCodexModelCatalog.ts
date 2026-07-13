import { useEffect, useState } from 'react';

import { api } from '../../../utils/api';
import { setCodexReasoningModelCatalog } from '../constants/codexReasoningSupport';

export type CodexModelOption = {
  value: string;
  label: string;
  description?: string;
  isDefault?: boolean;
  supportedReasoningEfforts?: string[];
  defaultReasoningEffort?: string | null;
};

type CodexModelCatalogResponse = {
  models?: CodexModelOption[];
  defaultModel?: string;
  error?: string;
};

export function useCodexModelCatalog() {
  const [models, setModels] = useState<CodexModelOption[]>([]);
  const [defaultModel, setDefaultModel] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadCatalog = async () => {
      try {
        const response = await api.settings.codexModels();
        const payload = await response.json() as CodexModelCatalogResponse;
        if (!response.ok) {
          throw new Error(payload.error || `Codex model catalog returned ${response.status}`);
        }

        const nextModels = Array.isArray(payload.models)
          ? payload.models.filter((model) => model?.value && model?.label)
          : [];
        const nextDefault = nextModels.some((model) => model.value === payload.defaultModel)
          ? payload.defaultModel || ''
          : nextModels.find((model) => model.isDefault)?.value || nextModels[0]?.value || '';

        if (!cancelled) {
          setCodexReasoningModelCatalog(nextModels);
          setModels(nextModels);
          setDefaultModel(nextDefault);
          setError(null);
        }
      } catch (loadError) {
        console.error('Error loading local Codex model catalog:', loadError);
        if (!cancelled) {
          setCodexReasoningModelCatalog([]);
          setModels([]);
          setDefaultModel('');
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void loadCatalog();
    return () => {
      cancelled = true;
    };
  }, []);

  return { models, defaultModel, isLoading, error };
}
