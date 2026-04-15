/**
 * Draft queue for sending skill commands from non-chat components (e.g., SkillsDashboard)
 * to the Chat interface. Uses sessionStorage + CustomEvent pattern.
 */

const STORAGE_KEY = 'lingzhi-lab-skill-command-draft';
export const SKILL_COMMAND_DRAFT_EVENT = 'lingzhi-lab-skill-command-draft';

export function queueSkillCommandDraft(command: string): void {
  window.sessionStorage.setItem(STORAGE_KEY, command);
  window.dispatchEvent(
    new CustomEvent(SKILL_COMMAND_DRAFT_EVENT, { detail: { command } }),
  );
}

export function consumeSkillCommandDraft(): string | null {
  const cmd = window.sessionStorage.getItem(STORAGE_KEY);
  if (cmd) {
    window.sessionStorage.removeItem(STORAGE_KEY);
  }
  return cmd;
}
