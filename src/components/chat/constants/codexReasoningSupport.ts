import type { CodexReasoningEffortId } from './codexReasoningEfforts';

const DEFAULT_ONLY: CodexReasoningEffortId[] = ['default'];
const VALID_EFFORTS = new Set<CodexReasoningEffortId>([
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
]);
const modelReasoningSupport = new Map<string, CodexReasoningEffortId[]>();

export function setCodexReasoningModelCatalog(
  models: Array<{ value: string; supportedReasoningEfforts?: string[] }>,
) {
  modelReasoningSupport.clear();
  for (const model of models) {
    const efforts = (model.supportedReasoningEfforts || [])
      .filter((effort): effort is CodexReasoningEffortId => VALID_EFFORTS.has(effort as CodexReasoningEffortId));
    modelReasoningSupport.set(model.value, ['default', ...efforts]);
  }
}

export function getSupportedCodexReasoningEfforts(model: string): CodexReasoningEffortId[] {
  return modelReasoningSupport.get(model) || DEFAULT_ONLY;
}

export function supportsExplicitCodexReasoningEffort(model: string): boolean {
  return getSupportedCodexReasoningEfforts(model).length > 1;
}
