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

function shouldDelete(relativePath) {
  const normalized = relativePath.split(path.sep).join('/');
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

function walkAndDelete(dirPath, removed) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walkAndDelete(fullPath, removed);
      continue;
    }

    const relativePath = path.relative(unpackedRoot, fullPath);
    if (!shouldDelete(relativePath)) {
      continue;
    }

    fs.unlinkSync(fullPath);
    removed.push(relativePath.split(path.sep).join('/'));
  }
}

function pruneEmptyDirs(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      pruneEmptyDirs(path.join(dirPath, entry.name));
    }
  }

  if (dirPath === unpackedRoot) {
    return;
  }

  const remaining = fs.readdirSync(dirPath);
  if (remaining.length === 0) {
    fs.rmdirSync(dirPath);
  }
}

function main() {
  if (!fs.existsSync(unpackedRoot)) {
    console.log(`[desktop:prune:unpacked] Skip: missing unpacked directory: ${unpackedRoot}`);
    return;
  }

  const removed = [];
  walkAndDelete(unpackedRoot, removed);
  pruneEmptyDirs(unpackedRoot);

  console.log(`[desktop:prune:unpacked] Removed ${removed.length} files.`);
}

main();
