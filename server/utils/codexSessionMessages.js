const WINDOWS_ABS_PATH = /^[A-Za-z]:[\\/]/;

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/\/+/g, '/').trim();
}

function isAbsolutePath(value) {
  return value.startsWith('/') || WINDOWS_ABS_PATH.test(value);
}

function parseJsonObject(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractTextContent(content) {
  if (!Array.isArray(content)) return content;
  return content
    .map((item) => {
      if (item?.type === 'input_text' || item?.type === 'output_text' || item?.type === 'text') {
        return item.text || '';
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function extractSearchResultFiles(output) {
  const files = new Set();
  String(output || '')
    .split('\n')
    .forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      const fileMatch = trimmed.match(/^(.+?):\d+(?::\d+)?:/);
      if (fileMatch?.[1]) {
        files.add(fileMatch[1].trim());
      }
    });

  return Array.from(files);
}

function parsePatchFilePaths(patchText) {
  const files = [];
  String(patchText || '')
    .split('\n')
    .forEach((line) => {
      // Known limitation: only matches Add/Delete/Update prefixes.
      // Real-world Codex patches may also use "Create File" — extend if needed.
      const addMatch = line.match(/^\*\*\* (?:Add|Delete|Update) File: (.+)$/);
      if (addMatch?.[1]) {
        files.push(addMatch[1].trim());
        return;
      }

      const moveMatch = line.match(/^\*\*\* Move to: (.+)$/);
      if (moveMatch?.[1]) {
        files.push(moveMatch[1].trim());
      }
    });

  return Array.from(new Set(files));
}

function toFileChangesToolInput(changes) {
  return Object.entries(changes || {})
    .map(([filePath, change]) => `${change?.type || 'update'}: ${filePath}`)
    .join('\n');
}

function normalizeCodexFunctionCall(name, rawArguments) {
  const parsedArguments = parseJsonObject(rawArguments);

  if (name === 'exec_command') {
    return {
      toolName: 'Bash',
      toolInput: JSON.stringify({
        command: parsedArguments?.cmd || '',
        workdir: parsedArguments?.workdir || parsedArguments?.cwd || '',
      }),
    };
  }

  if (name === 'write_stdin') {
    return {
      toolName: 'write_stdin',
      toolInput: rawArguments,
      skip: true,
    };
  }

  if (name === 'update_plan') {
    return {
      toolName: 'UpdatePlan',
      toolInput: JSON.stringify(parsedArguments || {}),
    };
  }

  if (name === 'view_image') {
    return {
      toolName: 'ViewImage',
      toolInput: JSON.stringify(parsedArguments || {}),
    };
  }

  return {
    toolName: name,
    toolInput: typeof rawArguments === 'string' ? rawArguments : JSON.stringify(parsedArguments || {}),
  };
}

function normalizeCodexCustomToolCall(name, input) {
  if (name !== 'apply_patch') {
    return {
      toolName: name || 'custom_tool',
      toolInput: input || '',
    };
  }

  const filePaths = parsePatchFilePaths(input);
  return {
    toolName: 'Edit',
    toolInput: JSON.stringify({
      file_path: filePaths[0] || 'unknown',
      file_paths: filePaths,
      patch: input || '',
    }),
  };
}

function normalizeExecCommandEvent(payload, fallbackInput) {
  const parsedCommand = Array.isArray(payload?.parsed_cmd) ? payload.parsed_cmd[0] : null;
  const output = payload?.aggregated_output || payload?.stdout || payload?.stderr || '';
  const isError = Number(payload?.exit_code ?? payload?.exitCode ?? 0) !== 0 || payload?.status === 'failed';

  if (parsedCommand?.type === 'read' && parsedCommand?.path) {
    return {
      toolName: 'Read',
      toolInput: JSON.stringify({ file_path: parsedCommand.path }),
      toolResult: {
        content: output,
        isError,
      },
    };
  }

  if (parsedCommand?.type === 'search') {
    const filenames = extractSearchResultFiles(output);
    return {
      toolName: 'Grep',
      toolInput: JSON.stringify({
        pattern: parsedCommand.query || '',
        path: parsedCommand.path || payload?.cwd || '',
        command: parsedCommand.cmd || fallbackInput?.command || '',
      }),
      toolResult: {
        content: output,
        isError,
        toolUseResult: filenames.length > 0 ? { filenames } : null,
      },
    };
  }

  if (parsedCommand?.type === 'list_files') {
    return {
      toolName: 'LS',
      toolInput: JSON.stringify({
        path: parsedCommand.path || payload?.cwd || '',
        command: parsedCommand.cmd || fallbackInput?.command || '',
      }),
      toolResult: {
        content: output,
        isError,
      },
    };
  }

  return {
    toolName: 'Bash',
    toolInput: JSON.stringify({
      command: fallbackInput?.command || '',
      workdir: fallbackInput?.workdir || payload?.cwd || '',
      parsed_cmd: payload?.parsed_cmd || [],
    }),
    toolResult: {
      content: output,
      isError,
    },
  };
}

function normalizePatchApplyEvent(payload) {
  const changes = payload?.changes || {};
  const content = [payload?.stdout, payload?.stderr].filter(Boolean).join('\n').trim();
  return {
    toolResult: {
      content,
      isError: payload?.success === false || payload?.status === 'failed',
      toolUseResult: { changes },
    },
    fileChangesToolInput: toFileChangesToolInput(changes),
  };
}

function normalizeWebSearchCall(payload) {
  const action = payload?.action || {};
  const type = action?.type;

  if (type === 'search') {
    return {
      toolName: 'WebSearch',
      toolInput: JSON.stringify({
        query: action.query || '',
        queries: action.queries || [],
      }),
    };
  }

  if (type === 'open_page') {
    return {
      toolName: 'OpenPage',
      toolInput: JSON.stringify({
        url: action.url || '',
      }),
    };
  }

  if (type === 'find_in_page') {
    return {
      toolName: 'FindInPage',
      toolInput: JSON.stringify({
        url: action.url || '',
        pattern: action.pattern || '',
      }),
    };
  }

  return {
    toolName: 'WebSearch',
    toolInput: JSON.stringify(action || {}),
  };
}

function buildToolUseMessage(timestamp, toolName, toolInput, toolCallId) {
  return {
    type: 'tool_use',
    timestamp,
    toolName,
    toolInput,
    toolCallId,
  };
}

function buildToolResultMessage(timestamp, toolCallId, output, extra = {}) {
  return {
    type: 'tool_result',
    timestamp,
    toolCallId,
    output,
    ...extra,
  };
}

export {
  buildToolResultMessage,
  buildToolUseMessage,
  extractTextContent,
  normalizeCodexCustomToolCall,
  normalizeCodexFunctionCall,
  normalizeExecCommandEvent,
  normalizePatchApplyEvent,
  normalizeWebSearchCall,
  parseJsonObject,
  parsePatchFilePaths,
};
