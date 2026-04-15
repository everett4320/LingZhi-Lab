const WORKSPACE_QA_DRAFT_PREFIX = 'lingzhi-lab-workspace-qa-draft:';

export const WORKSPACE_QA_DRAFT_EVENT = 'lingzhi-lab:workspace-qa-draft';

const getDraftKey = (projectName: string) => `${WORKSPACE_QA_DRAFT_PREFIX}${projectName}`;

export const queueWorkspaceQaDraft = (projectName: string, prompt: string) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.sessionStorage.setItem(getDraftKey(projectName), prompt);
  window.dispatchEvent(new CustomEvent(WORKSPACE_QA_DRAFT_EVENT, {
    detail: { projectName },
  }));
};

export const consumeWorkspaceQaDraft = (projectName: string): string | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  const key = getDraftKey(projectName);
  const draft = window.sessionStorage.getItem(key);
  if (!draft) {
    return null;
  }

  window.sessionStorage.removeItem(key);
  return draft;
};
