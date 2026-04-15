const DIAGRAM_STORAGE_PREFIX = 'lingzhi-lab-survey-diagram:';
const LEGACY_DIAGRAM_STORAGE_PREFIX = 'vibelab-survey-diagram:';

export function saveSurveyDiagramSource(source: string) {
  const diagramId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  localStorage.setItem(`${DIAGRAM_STORAGE_PREFIX}${diagramId}`, source);
  return diagramId;
}

export function loadSurveyDiagramSource(diagramId: string) {
  const currentKey = `${DIAGRAM_STORAGE_PREFIX}${diagramId}`;
  const currentValue = localStorage.getItem(currentKey);
  if (currentValue !== null) {
    return currentValue;
  }

  const legacyKey = `${LEGACY_DIAGRAM_STORAGE_PREFIX}${diagramId}`;
  const legacyValue = localStorage.getItem(legacyKey);
  if (legacyValue !== null) {
    localStorage.setItem(currentKey, legacyValue);
    localStorage.removeItem(legacyKey);
  }

  return legacyValue;
}
