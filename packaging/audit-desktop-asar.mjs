import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const asar = require('@electron/asar');

const repoRoot = process.cwd();
const releaseDir = path.join(repoRoot, 'release');
const maxViolationsToPrint = 100;

function toPosix(filePath) {
  return filePath.split(path.sep).join('/');
}

function findAsarFiles(dirPath, results = []) {
  if (!fs.existsSync(dirPath)) {
    return results;
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      findAsarFiles(fullPath, results);
      continue;
    }
    if (entry.isFile() && entry.name === 'app.asar') {
      results.push(fullPath);
    }
  }

  return results;
}

function isForbiddenAsarEntry(entry) {
  const normalized = entry.replace(/^\/+/, '');
  const basename = path.posix.basename(normalized);

  if (basename === '.DS_Store') return true;
  if (normalized.endsWith('.map')) return true;
  if (normalized.endsWith('.d.ts')) return true;
  if (/\.(test|spec)\.[cm]?js$/i.test(normalized)) return true;
  if (normalized.includes('/__tests__/')) return true;
  if (normalized.startsWith('src/')) return true;
  if (normalized.startsWith('packaging/')) return true;
  if (normalized.startsWith('scripts/')) return true;
  if (normalized === 'electron/README.md') return true;
  if (normalized === 'electron/cli.mjs') return true;
  if (normalized === 'server/AGENTS.md') return true;
  if (normalized.startsWith('server/__tests__/')) return true;
  if (normalized.startsWith('server/utils/__tests__/')) return true;
  if (normalized.startsWith('server/taskmaster-templates/') && normalized.endsWith('.md')) return true;

  return false;
}

function auditArchive(asarPath) {
  const entries = asar.listPackage(asarPath).map((item) => item.replace(/^\/+/, ''));
  const violations = entries.filter(isForbiddenAsarEntry).sort();

  if (violations.length > 0) {
    console.error(`[desktop:audit:asar] ${toPosix(path.relative(repoRoot, asarPath))} contains forbidden source/debug files:`);
    for (const violation of violations.slice(0, maxViolationsToPrint)) {
      console.error(` - ${violation}`);
    }
    if (violations.length > maxViolationsToPrint) {
      console.error(` - ... ${violations.length - maxViolationsToPrint} more`);
    }
    return false;
  }

  const requiredEntries = [
    'electron/main.mjs',
    'electron/preload.cjs',
    'server/index.js',
    'dist/index.html',
  ];

  const missing = requiredEntries.filter((entry) => !entries.includes(entry));
  if (missing.length > 0) {
    console.error(`[desktop:audit:asar] ${toPosix(path.relative(repoRoot, asarPath))} is missing required runtime entries:`);
    for (const item of missing) {
      console.error(` - ${item}`);
    }
    return false;
  }

  console.log(`[desktop:audit:asar] Passed: ${toPosix(path.relative(repoRoot, asarPath))}`);
  return true;
}

function main() {
  const asarFiles = findAsarFiles(releaseDir);
  if (asarFiles.length === 0) {
    console.error(`[desktop:audit:asar] No app.asar files found under ${releaseDir}`);
    process.exit(2);
  }

  const ok = asarFiles.map(auditArchive).every(Boolean);
  process.exit(ok ? 0 : 1);
}

main();
