#!/usr/bin/env node
/**
 * Fix node-pty spawn-helper permissions on macOS.
 *
 * node-pty prebuilds can ship spawn-helper without execute permissions,
 * which causes "posix_spawnp failed" when creating terminal sessions.
 */

import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function fixSpawnHelper() {
  if (process.platform !== "darwin") return;

  const nodeModulesPath = path.join(
    __dirname,
    "..",
    "node_modules",
    "node-pty",
    "prebuilds",
  );
  const darwinDirs = ["darwin-arm64", "darwin-x64"];

  for (const dir of darwinDirs) {
    const spawnHelperPath = path.join(nodeModulesPath, dir, "spawn-helper");

    try {
      await fs.access(spawnHelperPath);
      await fs.chmod(spawnHelperPath, 0o755);
      console.log(`[postinstall] Fixed permissions for ${spawnHelperPath}`);
    } catch (err) {
      if (err.code !== "ENOENT") {
        console.warn(
          `[postinstall] Warning: Could not fix ${spawnHelperPath}: ${err.message}`,
        );
      }
    }
  }
}

async function fixWindowsSpectreMitigation() {
  if (process.platform !== "win32") return;

  const files = [
    path.join(__dirname, "..", "node_modules", "node-pty", "binding.gyp"),
    path.join(
      __dirname,
      "..",
      "node_modules",
      "node-pty",
      "deps",
      "winpty",
      "src",
      "winpty.gyp",
    ),
  ];

  for (const filePath of files) {
    try {
      const original = await fs.readFile(filePath, "utf8");
      const updated = original.replace(
        /'SpectreMitigation'\s*:\s*'Disabled'/g,
        "'SpectreMitigation': 'false'",
      );

      if (updated !== original) {
        await fs.writeFile(filePath, updated, "utf8");
        console.log(
          `[postinstall] Patched SpectreMitigation in ${filePath} for current MSVC toolchain`,
        );
      }
    } catch (err) {
      if (err.code !== "ENOENT") {
        console.warn(
          `[postinstall] Warning: Could not patch ${filePath}: ${err.message}`,
        );
      }
    }
  }
}

async function main() {
  await fixSpawnHelper();
  await fixWindowsSpectreMitigation();
}

main().catch(console.error);
