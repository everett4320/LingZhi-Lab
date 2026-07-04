import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import * as esbuild from 'esbuild';

const repoRoot = process.cwd();
const stagingRoot = path.join(repoRoot, '.desktop-secure');

const jsExtensions = new Set(['.js', '.mjs', '.cjs']);

function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function isJsFile(filePath) {
  if (jsExtensions.has(path.extname(filePath))) {
    return true;
  }
  return toPosix(filePath).endsWith('server/bin/compute-node');
}

function shouldSkipCommon(relativePath) {
  const normalized = toPosix(relativePath);
  const basename = path.basename(relativePath);

  return basename === '.DS_Store'
    || basename === '.gitkeep'
    || normalized.includes('/__tests__/')
    || normalized.includes('/test/')
    || /\.test\.[cm]?js$/i.test(normalized)
    || normalized.endsWith('.map')
    || normalized.endsWith('.d.ts')
    || normalized.endsWith('.ts')
    || normalized.endsWith('.tsx')
    || normalized.endsWith('.jsx');
}

function shouldSkipServer(relativePath) {
  const normalized = toPosix(relativePath);
  if (shouldSkipCommon(relativePath)) return true;
  if (normalized === 'AGENTS.md') return true;
  if (normalized.startsWith('taskmaster-templates/') && normalized.endsWith('.md')) return true;
  return false;
}

function shouldSkipSkills(relativePath) {
  const basename = path.basename(relativePath);
  return basename === '.DS_Store' || basename === '.gitkeep' || relativePath.endsWith('.map');
}

async function ensureParent(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function writeMinifiedJs(sourcePath, destPath) {
  const original = await fs.readFile(sourcePath, 'utf8');
  const shebangMatch = original.match(/^#![^\n]*(?:\n|$)/);
  const shebang = shebangMatch ? shebangMatch[0].trimEnd() : '';
  const source = shebang ? original.slice(shebangMatch[0].length) : original;
  const ext = path.extname(sourcePath);
  const format = ext === '.cjs' ? 'cjs' : 'esm';

  const result = await esbuild.transform(source, {
    loader: 'js',
    format,
    target: 'node20',
    minify: true,
    sourcemap: false,
    legalComments: 'none',
    charset: 'ascii',
  });

  const output = shebang ? `${shebang}\n${result.code}` : result.code;
  await ensureParent(destPath);
  await fs.writeFile(destPath, output, 'utf8');

  const sourceMode = fsSync.statSync(sourcePath).mode;
  if (sourceMode & 0o111) {
    await fs.chmod(destPath, sourceMode & 0o777);
  }
}

async function copyFileSecure(sourcePath, destPath) {
  await ensureParent(destPath);
  if (isJsFile(sourcePath)) {
    await writeMinifiedJs(sourcePath, destPath);
    return;
  }
  await fs.copyFile(sourcePath, destPath);
}

async function copyTree(sourceDir, destDir, shouldSkip = shouldSkipCommon) {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const relativePath = path.relative(sourceDir, sourcePath);
    const destPath = path.join(destDir, relativePath);

    if (shouldSkip(relativePath)) {
      continue;
    }

    if (entry.isDirectory()) {
      await copyTree(sourcePath, destPath, (nestedRelative) => (
        shouldSkip(path.join(relativePath, nestedRelative))
      ));
      continue;
    }

    if (entry.isFile()) {
      await copyFileSecure(sourcePath, destPath);
    }
  }
}

async function copyRequiredElectronRuntime() {
  const electronDir = path.join(stagingRoot, 'electron');
  await fs.mkdir(electronDir, { recursive: true });
  await writeMinifiedJs(
    path.join(repoRoot, 'electron', 'main.mjs'),
    path.join(electronDir, 'main.mjs'),
  );
  await writeMinifiedJs(
    path.join(repoRoot, 'electron', 'preload.cjs'),
    path.join(electronDir, 'preload.cjs'),
  );
}

async function writeRuntimePackageJson() {
  const packageJson = JSON.parse(await fs.readFile(path.join(repoRoot, 'package.json'), 'utf8'));
  const runtimePackageJson = {
    name: packageJson.name,
    version: packageJson.version,
    description: packageJson.description,
    type: 'module',
    main: 'electron/main.mjs',
    license: packageJson.license,
  };

  await fs.writeFile(
    path.join(stagingRoot, 'package.json'),
    `${JSON.stringify(runtimePackageJson, null, 2)}\n`,
    'utf8',
  );
}

async function main() {
  await fs.rm(stagingRoot, { recursive: true, force: true });
  await fs.mkdir(stagingRoot, { recursive: true });

  await copyRequiredElectronRuntime();
  await copyTree(path.join(repoRoot, 'server'), path.join(stagingRoot, 'server'), shouldSkipServer);
  await copyTree(path.join(repoRoot, 'shared'), path.join(stagingRoot, 'shared'), shouldSkipCommon);
  await copyTree(path.join(repoRoot, 'dist'), path.join(stagingRoot, 'dist'), shouldSkipCommon);
  await copyTree(path.join(repoRoot, 'public'), path.join(stagingRoot, 'public'), shouldSkipCommon);
  await copyTree(path.join(repoRoot, 'skills'), path.join(stagingRoot, 'skills'), shouldSkipSkills);

  const buildDir = path.join(repoRoot, 'build');
  if (fsSync.existsSync(buildDir)) {
    await copyTree(buildDir, path.join(stagingRoot, 'build'), shouldSkipCommon);
  }

  await writeRuntimePackageJson();
  console.log(`[desktop:stage:secure] Prepared hardened runtime staging at ${stagingRoot}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
