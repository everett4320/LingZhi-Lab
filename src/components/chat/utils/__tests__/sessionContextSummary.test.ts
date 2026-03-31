import { describe, expect, it } from 'vitest';

import { deriveSessionContextSummary, mergeDistinctChatMessages } from '../sessionContextSummary';

describe('deriveSessionContextSummary', () => {
  const projectRoot = '/workspace/demo';

  it('extracts context files, outputs, tasks, and unread review state', () => {
    const messages = [
      {
        type: 'assistant',
        timestamp: '2026-03-26T10:00:00.000Z',
        isToolUse: true,
        toolName: 'Read',
        toolInput: JSON.stringify({ file_path: '/workspace/demo/src/app.ts' }),
      },
      {
        type: 'assistant',
        timestamp: '2026-03-26T10:01:00.000Z',
        isToolUse: true,
        toolName: 'Grep',
        toolInput: JSON.stringify({ pattern: 'build' }),
        toolResult: {
          content: 'ok',
          isError: false,
          toolUseResult: {
            filenames: ['src/app.ts', 'docs/plan.md'],
          },
        },
      },
      {
        type: 'assistant',
        timestamp: '2026-03-26T10:02:00.000Z',
        isToolUse: true,
        toolName: 'TodoWrite',
        toolInput: JSON.stringify({
          todos: [
            { content: 'Review draft', status: 'in_progress', priority: 'high' },
          ],
        }),
      },
      {
        type: 'assistant',
        timestamp: '2026-03-26T10:03:00.000Z',
        isToolUse: true,
        toolName: 'Write',
        toolInput: JSON.stringify({ file_path: 'outputs/report.md', content: '# report' }),
      },
      {
        type: 'assistant',
        timestamp: '2026-03-26T10:04:00.000Z',
        isTaskNotification: true,
        taskId: '42',
        taskOutputFile: 'outputs/notes.txt',
        content: 'Background task finished',
      },
    ] as any;

    const summary = deriveSessionContextSummary(messages, projectRoot, {
      'outputs/report.md': {
        reviewedAt: '2026-03-26T10:05:00.000Z',
      },
    });

    expect(summary.contextFiles.map((item) => item.relativePath).sort()).toEqual([
      'docs/plan.md',
      'src/app.ts',
    ]);
    expect(summary.tasks.some((item) => item.label === 'Review draft')).toBe(true);
    expect(summary.tasks.some((item) => item.label === 'Task 42')).toBe(true);
    expect(summary.outputFiles.map((item) => ({ path: item.relativePath, unread: item.unread }))).toEqual([
      { path: 'outputs/notes.txt', unread: true },
      { path: 'outputs/report.md', unread: false },
    ]);
    expect(summary.unreadCount).toBe(1);
  });

  it('marks an output unread again when it changes after review', () => {
    const messages = [
      {
        type: 'assistant',
        timestamp: '2026-03-26T10:00:00.000Z',
        isToolUse: true,
        toolName: 'Edit',
        toolInput: JSON.stringify({ file_path: 'outputs/report.md' }),
      },
      {
        type: 'assistant',
        timestamp: '2026-03-26T10:06:00.000Z',
        isToolUse: true,
        toolName: 'Edit',
        toolInput: JSON.stringify({ file_path: 'outputs/report.md' }),
      },
    ] as any;

    const summary = deriveSessionContextSummary(messages, projectRoot, {
      'outputs/report.md': {
        reviewedAt: '2026-03-26T10:05:00.000Z',
      },
    });

    expect(summary.outputFiles[0].relativePath).toBe('outputs/report.md');
    expect(summary.outputFiles[0].unread).toBe(true);
  });

  it('recognizes Codex shell reads, plans, patch outputs, and web actions', () => {
    const messages = [
      {
        type: 'assistant',
        timestamp: '2026-03-30T05:18:28.000Z',
        isToolUse: true,
        toolName: 'Bash',
        toolInput: JSON.stringify({
          command: "sed -n '1,200p' src/components/chat/utils/sessionContextSummary.ts",
          workdir: projectRoot,
        }),
        toolResult: {
          content: 'const summary = true;',
          isError: false,
        },
      },
      {
        type: 'assistant',
        timestamp: '2026-03-30T05:19:00.000Z',
        isToolUse: true,
        toolName: 'UpdatePlan',
        toolInput: JSON.stringify({
          plan: [
            { step: 'Normalize Codex history', status: 'in_progress' },
            { step: 'Expand session summary', status: 'pending' },
          ],
        }),
      },
      {
        type: 'assistant',
        timestamp: '2026-03-30T05:20:00.000Z',
        isToolUse: true,
        toolName: 'Edit',
        toolInput: JSON.stringify({
          file_path: 'src/components/chat/utils/sessionContextSummary.ts',
          file_paths: [
            'src/components/chat/utils/sessionContextSummary.ts',
            'docs/plan.md',
          ],
        }),
        toolResult: {
          content: 'Success',
          isError: false,
          toolUseResult: {
            changes: {
              'src/components/chat/utils/sessionContextSummary.ts': { type: 'update' },
              'docs/plan.md': { type: 'add' },
            },
          },
        },
      },
      {
        type: 'assistant',
        timestamp: '2026-03-30T05:21:00.000Z',
        isToolUse: true,
        toolName: 'WebSearch',
        toolInput: JSON.stringify({ query: 'Codex session context panel' }),
      },
      {
        type: 'assistant',
        timestamp: '2026-03-30T05:21:30.000Z',
        isToolUse: true,
        toolName: 'OpenPage',
        toolInput: JSON.stringify({ url: 'https://developers.openai.com/api/docs' }),
      },
      {
        type: 'assistant',
        timestamp: '2026-03-30T05:22:00.000Z',
        isToolUse: true,
        toolName: 'FindInPage',
        toolInput: JSON.stringify({
          url: 'https://developers.openai.com/api/docs',
          pattern: 'session',
        }),
      },
    ] as any;

    const summary = deriveSessionContextSummary(messages, projectRoot);

    expect(summary.contextFiles.some((item) => item.relativePath === 'src/components/chat/utils/sessionContextSummary.ts')).toBe(true);
    expect(summary.outputFiles.map((item) => item.relativePath).sort()).toEqual([
      'docs/plan.md',
      'src/components/chat/utils/sessionContextSummary.ts',
    ]);
    expect(summary.tasks.some((item) => item.label === 'Normalize Codex history' && item.kind === 'todo')).toBe(true);
    expect(summary.tasks.some((item) => item.label === 'Codex session context panel')).toBe(true);
    expect(summary.tasks.some((item) => item.label === 'https://developers.openai.com/api/docs')).toBe(true);
    expect(summary.tasks.some((item) => item.label === 'session')).toBe(true);
  });

  it('ignores dotted shell fragments that are not real file paths', () => {
    const messages = [
      {
        type: 'assistant',
        timestamp: '2026-03-31T12:00:00.000Z',
        isToolUse: true,
        toolName: 'Bash',
        toolInput: JSON.stringify({
          command: "jq '.sections.survey.synthesis_summary, .sections.survey.open_gaps' pipeline/docs/research_brief.json",
          workdir: projectRoot,
        }),
        toolResult: {
          content: '',
          isError: false,
        },
      },
    ] as any;

    const summary = deriveSessionContextSummary(messages, projectRoot);
    const contextPaths = summary.contextFiles.map((item) => item.relativePath);

    expect(contextPaths).toContain('pipeline/docs/research_brief.json');
    expect(contextPaths.some((path) => path.includes('sections.survey'))).toBe(false);
    expect(contextPaths.some((path) => path.includes('open_gaps'))).toBe(false);
  });
});

describe('mergeDistinctChatMessages', () => {
  it('keeps one copy of duplicated tool events and sorts by timestamp', () => {
    const merged = mergeDistinctChatMessages(
      [
        {
          type: 'assistant',
          timestamp: '2026-03-26T10:00:00.000Z',
          isToolUse: true,
          toolId: 'tool-1',
          toolName: 'Read',
          toolInput: JSON.stringify({ file_path: 'src/app.ts' }),
        },
      ] as any,
      [
        {
          type: 'assistant',
          timestamp: '2026-03-26T10:00:00.000Z',
          isToolUse: true,
          toolId: 'tool-1',
          toolName: 'Read',
          toolInput: JSON.stringify({ file_path: 'src/app.ts' }),
        },
        {
          type: 'assistant',
          timestamp: '2026-03-26T10:01:00.000Z',
          content: 'Done',
        },
      ] as any,
    );

    expect(merged).toHaveLength(2);
    expect(merged[0].timestamp).toBe('2026-03-26T10:00:00.000Z');
    expect(merged[1].timestamp).toBe('2026-03-26T10:01:00.000Z');
  });
});
