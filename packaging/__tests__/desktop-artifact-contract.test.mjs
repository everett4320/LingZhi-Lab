import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const buildDir = path.join(repoRoot, 'build');
const releaseDir = path.join(repoRoot, 'release');
const packageJsonPath = path.join(repoRoot, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

function exists(relativePath) {
  return fs.existsSync(path.join(repoRoot, relativePath));
}

function readDirNames(absoluteDir) {
  if (!fs.existsSync(absoluteDir)) return [];
  return fs.readdirSync(absoluteDir);
}

describe('desktop packaging: artifact contracts', () => {
  describe('pre-build icon pipeline outputs', () => {
    it('keeps source icon file for desktop icon generation', () => {
      expect(exists('public/lingzhi-lab.png')).toBe(true);
    });

    it('generates build/icon.png', () => {
      expect(exists('build/icon.png')).toBe(true);
    });

    it('generates build/icon.ico', () => {
      expect(exists('build/icon.ico')).toBe(true);
    });

    it('generates macOS iconset directory', () => {
      expect(exists('build/icon.iconset')).toBe(true);
    });

    it('icon.png has non-zero size', () => {
      const stat = fs.statSync(path.join(buildDir, 'icon.png'));
      expect(stat.size).toBeGreaterThan(0);
    });

    it('icon.ico has non-zero size', () => {
      const stat = fs.statSync(path.join(buildDir, 'icon.ico'));
      expect(stat.size).toBeGreaterThan(0);
    });

    it.each([
      'icon_16x16.png',
      'icon_16x16@2x.png',
      'icon_32x32.png',
      'icon_32x32@2x.png',
      'icon_64x64.png',
      'icon_64x64@2x.png',
      'icon_128x128.png',
      'icon_128x128@2x.png',
      'icon_256x256.png',
      'icon_256x256@2x.png',
      'icon_512x512.png',
      'icon_512x512@2x.png',
      'icon_1024x1024.png',
    ])('has expected mac iconset file: %s', (iconName) => {
      expect(fs.existsSync(path.join(buildDir, 'icon.iconset', iconName))).toBe(true);
    });
  });

  describe('release directory outputs', () => {
    it('contains latest.yml metadata after windows dist', () => {
      expect(exists('release/latest.yml')).toBe(true);
    });

    it('contains at least one windows installer exe artifact', () => {
      const releaseEntries = readDirNames(releaseDir);
      const exeEntries = releaseEntries.filter((name) => name.toLowerCase().endsWith('.exe'));
      expect(exeEntries.length).toBeGreaterThan(0);
    });

    it('contains blockmap alongside installer', () => {
      const releaseEntries = readDirNames(releaseDir);
      const blockmaps = releaseEntries.filter((name) => name.toLowerCase().endsWith('.exe.blockmap'));
      expect(blockmaps.length).toBeGreaterThan(0);
    });

    it('contains unpacked windows app directory', () => {
      expect(exists('release/win-unpacked')).toBe(true);
    });

    it('contains packaged app.asar in win-unpacked/resources', () => {
      expect(exists('release/win-unpacked/resources/app.asar')).toBe(true);
    });

    it('contains app.asar.unpacked for native modules', () => {
      expect(exists('release/win-unpacked/resources/app.asar.unpacked')).toBe(true);
    });

    it('contains Lingzhi Lab executable in win-unpacked', () => {
      expect(exists('release/win-unpacked/Lingzhi Lab.exe')).toBe(true);
    });

    it('contains updater metadata in win-unpacked/resources', () => {
      expect(exists('release/win-unpacked/resources/app-update.yml')).toBe(true);
    });
  });

  describe('ASAR unpack expectations for native modules', () => {
    const unpackedBase = path.join(
      repoRoot,
      'release',
      'win-unpacked',
      'resources',
      'app.asar.unpacked',
      'node_modules',
    );

    it('keeps better-sqlite3 unpacked', () => {
      expect(fs.existsSync(path.join(unpackedBase, 'better-sqlite3'))).toBe(true);
    });

    it('keeps sqlite3 unpacked', () => {
      expect(fs.existsSync(path.join(unpackedBase, 'sqlite3'))).toBe(true);
    });

    it('keeps node-pty unpacked', () => {
      expect(fs.existsSync(path.join(unpackedBase, 'node-pty'))).toBe(true);
    });

    it('does not leak sourcemaps in unpacked native module payloads', () => {
      const leakedMaps = [];
      const walk = (dirPath) => {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);
          if (entry.isDirectory()) {
            walk(fullPath);
            continue;
          }
          if (entry.name.endsWith('.map')) {
            leakedMaps.push(path.relative(unpackedBase, fullPath));
          }
        }
      };
      walk(unpackedBase);
      expect(leakedMaps).toEqual([]);
    });

    it('does not leak test files in unpacked native module payloads', () => {
      const leakedTests = [];
      const walk = (dirPath) => {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);
          if (entry.isDirectory()) {
            walk(fullPath);
            continue;
          }
          if (/\.test\.[^/]+$/i.test(entry.name)) {
            leakedTests.push(path.relative(unpackedBase, fullPath));
          }
        }
      };
      walk(unpackedBase);
      expect(leakedTests).toEqual([]);
    });
  });

  describe('artifact naming contract', () => {
    it('release exe naming follows product-version-win-arch.ext pattern', () => {
      const releaseEntries = readDirNames(releaseDir);
      const productName = packageJson.build.productName;
      const version = packageJson.version;
      const expectedPrefix = `${productName}-${version}-win-`;
      const matchingExe = releaseEntries.find((entry) => entry.startsWith(expectedPrefix) && entry.endsWith('.exe'));
      expect(matchingExe).toBeTruthy();
    });
  });
});
