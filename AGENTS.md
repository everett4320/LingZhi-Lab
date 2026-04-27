# Repository Workflow

This file applies to the whole repository unless a deeper `AGENTS.md` overrides it. For example, `server/AGENTS.md` still applies inside `server/`.

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

Tradeoff: These guidelines bias toward caution over speed. For trivial tasks, use judgment.

1. Think Before Coding
Don't assume. Don't hide confusion. Surface tradeoffs.

Before implementing:

State your assumptions explicitly. If uncertain, ask.
If multiple interpretations exist, present them - don't pick silently.
If a simpler approach exists, say so. Push back when warranted.
If something is unclear, stop. Name what's confusing. Ask.
2. Simplicity First
Minimum code that solves the problem. Nothing speculative.

No features beyond what was asked.
No abstractions for single-use code.
No "flexibility" or "configurability" that wasn't requested.
No error handling for impossible scenarios.
If you write 200 lines and it could be 50, rewrite it.
Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

3. Surgical Changes
Touch only what you must. Clean up only your own mess.

When editing existing code:

Don't "improve" adjacent code, comments, or formatting.
Don't refactor things that aren't broken.
Match existing style, even if you'd do it differently.
If you notice unrelated dead code, mention it - don't delete it.
When your changes create orphans:

Remove imports/variables/functions that YOUR changes made unused.
Don't remove pre-existing dead code unless asked.
The test: Every changed line should trace directly to the user's request.

4. Goal-Driven Execution
Define success criteria. Loop until verified.

Transform tasks into verifiable goals:

"Add validation" 鈫?"Write tests for invalid inputs, then make them pass"
"Fix the bug" 鈫?"Write a test that reproduces it, then make it pass"
"Refactor X" 鈫?"Ensure tests pass before and after"
For multi-step tasks, state a brief plan:

1. [Step] 鈫?verify: [check]
2. [Step] 鈫?verify: [check]
3. [Step] 鈫?verify: [check]
Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

These guidelines are working if: fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.





## Remotes

- `upstream` is the source-of-truth repo. Fetch from it, but do not push to it.
- `origin` is the Lingzhi Lab fork used for backup and collaboration.
- This repo is configured with `remote.upstream.pushurl=DISABLED` to reduce accidental upstream pushes.

## Long-Lived Branches

- `main` must stay aligned with `upstream/main`.
- Never put custom-only branding, file removals, local restrictions, or Lingzhi-specific behavior directly on `main`.
- `custom` is the long-lived Lingzhi Lab branch for product-specific changes that should not go upstream.

## Short-Lived Branches

- Create `topic/upstream/<name>` from `main` for changes that may be proposed upstream.
- Create `topic/custom/<name>` from `custom` for changes that are intentionally custom-only.
- Keep temporary branches short-lived. Delete them after merge or cherry-pick.

## Change Routing

- If a change might be useful upstream, start from `main`.
- If the same change is also needed in `custom`, either cherry-pick it into `custom` with `git cherry-pick -x <commit>` or wait for it to land on `main` and then merge `main` into `custom`.
- If a change is clearly Lingzhi-only, start from `custom` and keep it off `main`.

## Worktrees

- `C:\鐭ュ煙姹嘰lingzhi-lab` is the `main` worktree.
- `C:\鐭ュ煙姹嘰lingzhi-lab-custom` is the `custom` worktree.
- If an upstream-bound branch needs a long-running effort, create an extra temporary worktree for that topic branch instead of mixing files in the same folder.

## Stable Promotion Rule

- When Lingzhi Lab explicitly declares a branch or commit as stable, move local `main` to that stable ref (for example: `git branch -f main <stable-ref>`).
- Treat the promoted stable ref as the default baseline in the `lingzhi-lab` worktree.
- Only push a rewritten `main` pointer to remotes when explicitly requested for that promotion.

## Daily Sync

Use this flow to keep the fork healthy:

```powershell
git fetch upstream --prune
git switch main
git merge --ff-only upstream/main
git push origin main

git switch custom
git merge main
git push origin custom
```

## Guardrails

- `main` should stay fast-forwardable to `upstream/main`.
- Do not keep long-lived remote branches other than `origin/main` and `origin/custom` unless there is a temporary reason.
- Prefer `git cherry-pick -x` when moving an upstream-ready fix from a `topic/upstream/...` branch into `custom`.
- When in doubt, ask one question first: "Could this reasonably go upstream?" If yes, begin on `main`.

## Desktop Packaging And Install Rule (lingzhi-lab)

- When user asks to package the Windows desktop app, do not stop at build/package completion.
- Before installing a new package, fully remove old installed app files first (uninstall if available, then clean the install directory).
- After packaging, install the produced Windows app so the user can launch it immediately.
- Treat local Windows install as a single linear version: keep exactly one active install in `%LOCALAPPDATA%\\Programs\\lingzhi-lab` and always replace it in-place.
- Required verification after install:
  1. Confirm a launchable exe exists in the install directory.
  2. Start the app once and confirm it starts (process must stay alive during verification window; immediate exit is failure).
  3. Ensure or update a desktop shortcut pointing to the installed exe.
  4. Open the app for the user at the end of the packaging flow.
- Preferred sequence:
  1. Build installer with npm run desktop:dist:win.
  2. Attempt silent NSIS install.
  3. If silent install is not reliable, deploy release/win-unpacked into a stable local app directory and wire desktop shortcut.
- Always report installed exe path and desktop shortcut path in the completion message.
