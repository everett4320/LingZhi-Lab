import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();
const unpackedRoot = path.join(
  repoRoot,
  'release',
  'win-unpacked',
  'resources',
  'app.asar.unpacked',
);

const allowlist = new Set([
  // Keep this list intentionally small. Add entries only with explicit review.
]);

const violations = [];

function isViolation(relativePath) {
  const normalized = relativePath.split(path.sep).join('/');
  if (allowlist.has(normalized)) {
    return false;
  }

  if (normalized.endsWith('.map')) {
    return true;
  }

  if (/\.test\.[^/]+$/i.test(normalized)) {
    return true;
  }

  if (/\/src\/.*\.ts$/i.test(normalized)) {
    return true;
  }

  return false;
}

function walk(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }

    const relativePath = path.relative(unpackedRoot, fullPath);
    if (isViolation(relativePath)) {
      violations.push(relativePath.split(path.sep).join('/'));
    }
  }
}

function main() {
  if (!fs.existsSync(unpackedRoot)) {
    console.error(`[desktop:audit:artifact] Missing unpacked directory: ${unpackedRoot}`);
    process.exit(2);
  }

  walk(unpackedRoot);

  if (violations.length > 0) {
    console.error('[desktop:audit:artifact] Found disallowed unpacked files:');
    for (const item of violations.sort()) {
      console.error(` - ${item}`);
    }
    process.exit(1);
  }

  console.log('[desktop:audit:artifact] Passed: no disallowed unpacked files found.');
}

main();
