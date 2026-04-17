import fsSync from 'fs';
import readline from 'readline';

import { getCodexSessions } from './projects.js';

const CACHE_TTL_MS = 5_000;

let summaryCache = null;

function createEmptyUsageTotals() {
  return {
    todayTokens: 0,
    weekTokens: 0,
  };
}

function normalizeProjectRefs(projectRefs = []) {
  return projectRefs
    .filter((project) => project && typeof project.name === 'string' && typeof project.fullPath === 'string')
    .map((project) => ({
      name: project.name,
      fullPath: project.fullPath,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getUsageWindowBounds(now = new Date()) {
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const weekStart = new Date(todayStart);
  const dayOfWeek = weekStart.getDay();
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  weekStart.setDate(weekStart.getDate() - daysSinceMonday);

  return {
    nowMs: now.getTime(),
    todayStartMs: todayStart.getTime(),
    weekStartMs: weekStart.getTime(),
    cacheKey: `${todayStart.toISOString()}|${weekStart.toISOString()}`,
  };
}

function addUsageForTimestamp(target, timestampMs, tokens, bounds) {
  if (!Number.isFinite(timestampMs) || !Number.isFinite(tokens) || tokens <= 0) {
    return;
  }

  if (timestampMs >= bounds.weekStartMs && timestampMs <= bounds.nowMs) {
    target.weekTokens += tokens;
  }

  if (timestampMs >= bounds.todayStartMs && timestampMs <= bounds.nowMs) {
    target.todayTokens += tokens;
  }
}

function getCodexCumulativeTokens(entry) {
  const totalTokens = Number(entry?.payload?.info?.total_token_usage?.total_tokens || 0);
  return Number.isFinite(totalTokens) ? totalTokens : 0;
}

function getCodexLastTokens(entry) {
  const lastTokens = Number(entry?.payload?.info?.last_token_usage?.total_tokens || 0);
  return Number.isFinite(lastTokens) ? lastTokens : 0;
}

async function summarizeCodexProject(projectRef, bounds, codexIndexRef) {
  const totals = createEmptyUsageTotals();
  const sessions = await getCodexSessions(projectRef.fullPath, {
    limit: 0,
    indexRef: codexIndexRef,
  });

  for (const session of sessions) {
    if (!session?.filePath) {
      continue;
    }

    let previousCumulativeTokens = 0;

    try {
      const fileStream = fsSync.createReadStream(session.filePath);
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        if (!line.trim()) {
          continue;
        }

        try {
          const entry = JSON.parse(line);
          if (entry.type !== 'event_msg' || entry.payload?.type !== 'token_count' || !entry.payload?.info) {
            continue;
          }

          const timestampMs = new Date(entry.timestamp || 0).getTime();
          const cumulativeTokens = getCodexCumulativeTokens(entry);
          let deltaTokens = 0;

          if (cumulativeTokens > previousCumulativeTokens) {
            deltaTokens = cumulativeTokens - previousCumulativeTokens;
            previousCumulativeTokens = cumulativeTokens;
          } else if (cumulativeTokens < previousCumulativeTokens) {
            const lastTokens = getCodexLastTokens(entry);
            if (lastTokens > 0) {
              deltaTokens = lastTokens;
            }
            previousCumulativeTokens = Math.max(cumulativeTokens, 0);
          }

          addUsageForTimestamp(totals, timestampMs, deltaTokens, bounds);
        } catch {
          // Skip malformed JSONL rows.
        }
      }
    } catch (error) {
      console.warn(`[token-usage] Failed to read Codex session file ${session.filePath}:`, error.message);
    }
  }

  return totals;
}

function mergeUsageTotals(...totalsList) {
  return totalsList.reduce((merged, totals) => ({
    todayTokens: merged.todayTokens + Number(totals?.todayTokens || 0),
    weekTokens: merged.weekTokens + Number(totals?.weekTokens || 0),
  }), createEmptyUsageTotals());
}

export async function getProjectTokenUsageSummary(projectRefs = []) {
  const normalizedProjectRefs = normalizeProjectRefs(projectRefs);
  const bounds = getUsageWindowBounds();
  const cacheKey = `${bounds.cacheKey}|${JSON.stringify(normalizedProjectRefs)}`;

  if (summaryCache && summaryCache.key === cacheKey && summaryCache.expiresAt > Date.now()) {
    return summaryCache.data;
  }

  const codexIndexRef = { sessionsByProject: null };
  const projectUsageEntries = await Promise.all(
    normalizedProjectRefs.map(async (projectRef) => {
      const codexTotals = await summarizeCodexProject(projectRef, bounds, codexIndexRef);

      return [
        projectRef.name,
        mergeUsageTotals(codexTotals),
      ];
    }),
  );

  const projects = Object.fromEntries(projectUsageEntries);
  const workspace = Object.values(projects).reduce(
    (accumulator, totals) => mergeUsageTotals(accumulator, totals),
    createEmptyUsageTotals(),
  );

  const data = {
    generatedAt: new Date().toISOString(),
    workspace,
    projects,
  };

  summaryCache = {
    key: cacheKey,
    expiresAt: Date.now() + CACHE_TTL_MS,
    data,
  };

  return data;
}

export function clearProjectTokenUsageSummaryCache() {
  summaryCache = null;
}
