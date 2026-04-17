export function decodeHtmlEntities(text: string) {
  if (!text) return text;
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

export function normalizeInlineCodeFences(text: string) {
  if (!text || typeof text !== 'string') return text;
  try {
    return text.replace(/```\s*([^\n\r]+?)\s*```/g, '`$1`');
  } catch {
    return text;
  }
}

export function unescapeWithMathProtection(text: string) {
  if (!text || typeof text !== 'string') return text;

  const mathBlocks: string[] = [];
  const placeholderPrefix = '__MATH_BLOCK_';
  const placeholderSuffix = '__';

  let processedText = text.replace(/\$\$([\s\S]*?)\$\$|\$([^\$\n]+?)\$/g, (match) => {
    const index = mathBlocks.length;
    mathBlocks.push(match);
    return `${placeholderPrefix}${index}${placeholderSuffix}`;
  });

  processedText = processedText.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r');

  processedText = processedText.replace(
    new RegExp(`${placeholderPrefix}(\\d+)${placeholderSuffix}`, 'g'),
    (_match, index) => {
      return mathBlocks[parseInt(index, 10)];
    },
  );

  return processedText;
}

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const UNICODE_TREE_RE = /[\u2500-\u257F]/;
const ASCII_TREE_PREFIXES: RegExp[] = [
  /^\s*\|--\s+/,
  /^\s*`--\s+/,
  /^\s*\\--\s+/,
  /^\s*\+--\s+/,
  /^\s*\|__\s+/,
  /^\s*\+__\s+/,
];

function isTreeLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }

  if (UNICODE_TREE_RE.test(trimmed)) {
    return true;
  }

  return ASCII_TREE_PREFIXES.some((pattern) => pattern.test(trimmed));
}

function isTreeContinuationLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) {
    return true;
  }

  if (trimmed === '|' || trimmed === '||') {
    return true;
  }

  return /^[\u2502\s]+$/.test(trimmed);
}

function isPossibleRootLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }

  if (trimmed.endsWith('/') || trimmed.endsWith('\\')) {
    return true;
  }

  if (trimmed.startsWith('./') || trimmed.startsWith('../') || trimmed.startsWith('/') || /^[A-Za-z]:[\\/]/.test(trimmed)) {
    return true;
  }

  return !trimmed.includes(' ') && /[\\/]/.test(trimmed);
}

export function formatFileTreeInContent(text: string): string {
  if (!text || typeof text !== 'string') return text;

  const lines = text.split('\n');
  const result: string[] = [];
  let isInTree = false;
  let treeLines: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (isTreeLine(line)) {
      if (!isInTree) {
        if (result.length > 0 && isPossibleRootLine(result[result.length - 1])) {
          const rootLine = result.pop()!;
          treeLines = [rootLine, line];
        } else {
          treeLines = [line];
        }
        isInTree = true;
      } else {
        treeLines.push(line);
      }
      continue;
    }

    if (isInTree) {
      if (isTreeContinuationLine(line)) {
        treeLines.push(line);
        continue;
      }

      result.push(`\`\`\`text\n${treeLines.join('\n')}\n\`\`\``);
      result.push(line);
      treeLines = [];
      isInTree = false;
      continue;
    }

    result.push(line);
  }

  if (isInTree && treeLines.length > 0) {
    result.push(`\`\`\`text\n${treeLines.join('\n')}\n\`\`\``);
  }

  return result.join('\n');
}

export function formatUsageLimitText(text: string) {
  try {
    if (typeof text !== 'string') return text;

    let formattedText = formatFileTreeInContent(text);

    // Remove inline thinking blocks from assistant output.
    formattedText = formattedText.replace(/<thinking>[\s\S]*?<\/thinking>\s*/g, '');

    const localTimezone = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC';
    const USAGE_LIMIT_FALLBACK = 'AI usage limit reached. Please try again later.';
    const usagePattern = /(?:Codex|Claude)?\s*AI usage limit reached\|(\d{10,13})/g;

    formattedText = formattedText.replace(usagePattern, (_match, ts) => {
      try {
        const epoch = ts.length <= 10 ? Number(ts) * 1000 : Number(ts);
        const resetDate = new Date(epoch);
        if (Number.isNaN(resetDate.getTime())) return USAGE_LIMIT_FALLBACK;
        const time = resetDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const totalMinutes = Math.abs(resetDate.getTimezoneOffset());
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        const sign = resetDate.getTimezoneOffset() <= 0 ? '+' : '-';
        const offset = `GMT${sign}${hours}${minutes ? `:${String(minutes).padStart(2, '0')}` : ''}`;
        const date = resetDate.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
        return `AI usage limit reached. Your limit will reset at **${time} ${offset} (${localTimezone})** - ${date}`;
      } catch {
        return USAGE_LIMIT_FALLBACK;
      }
    });

    return formattedText;
  } catch {
    return text;
  }
}

// Re-export from shared module as the single parser source for legacy Gemini thought blocks.
import { splitLegacyGeminiThoughtContent } from '../../../../shared/geminiThoughtParser.js';
export { splitLegacyGeminiThoughtContent };

export function buildAssistantMessages(
  content: string,
  timestamp: Date | string | number,
): Array<{ type: string; content: string; timestamp: Date | string | number; isThinking?: boolean }> {
  const legacySegments = splitLegacyGeminiThoughtContent(content);
  if (legacySegments) {
    return legacySegments.map((segment) => ({
      type: 'assistant',
      content: segment.content,
      timestamp,
      ...(segment.isThinking ? { isThinking: true } : {}),
    }));
  }
  return [{ type: 'assistant', content, timestamp }];
}

export function getProviderDisplayName(_provider: string): string {
  return 'Codex';
}
