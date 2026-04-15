import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const workflowPath = path.join(repoRoot, '.github', 'workflows', 'desktop-release.yml');
const workflowText = fs.readFileSync(workflowPath, 'utf8');

function expectContains(text) {
  expect(workflowText).toContain(text);
}

describe('desktop packaging: CI workflow contracts', () => {
  it('defines Desktop Release workflow name', () => {
    expectContains('name: Desktop Release');
  });

  it('supports manual workflow dispatch', () => {
    expectContains('workflow_dispatch:');
  });

  it('supports tag-triggered release flow', () => {
    expectContains("tags:");
    expectContains("- 'v*'");
  });

  it('keeps matrix build job for desktop targets', () => {
    expectContains('build-desktop:');
    expectContains('strategy:');
    expectContains('matrix:');
  });

  it('includes macOS build target in matrix', () => {
    expectContains('os: macos-latest');
    expectContains('platform_args: --mac dmg');
    expectContains('artifact_name: desktop-macos-unsigned');
    expectContains('artifact_name: desktop-macos-signed');
    expectContains('artifact_glob: release/*.dmg');
  });

  it('includes Windows build target in matrix', () => {
    expectContains('os: windows-latest');
    expectContains('platform_args: --win nsis');
    expectContains('artifact_name: desktop-windows-unsigned');
    expectContains('artifact_name: desktop-windows-signed');
    expectContains('artifact_glob: release/*.exe');
  });

  it('pins Node.js major version in CI', () => {
    expectContains('Use Node.js 22');
    expectContains("node-version: '22'");
  });

  it('uses npm cache for faster installs', () => {
    expectContains("cache: 'npm'");
  });

  it('installs dependencies via npm ci', () => {
    expectContains('run: npm ci');
  });

  it('runs packaging contract tests before packaging in CI', () => {
    expectContains('name: Packaging contract gate');
    expectContains('run: npm run test -- packaging/__tests__/desktop-package-config.test.mjs packaging/__tests__/desktop-runtime-robustness.test.mjs packaging/__tests__/desktop-security-hardening.test.mjs packaging/__tests__/desktop-workflow-contract.test.mjs');
  });

  it('builds desktop distributables via desktop:dist for unsigned and signed channels', () => {
    expectContains('run: npm run desktop:dist -- ${{ matrix.platform_args }} --publish never');
    expectContains("if: matrix.release_channel == 'unsigned'");
    expectContains("if: matrix.release_channel == 'signed'");
  });

  it('forces CI to skip Apple auto-discovery signing for beta builds', () => {
    expectContains("CSC_IDENTITY_AUTO_DISCOVERY: 'false'");
  });

  it('enables signing auto-discovery in signed channel', () => {
    expectContains("CSC_IDENTITY_AUTO_DISCOVERY: 'true'");
  });

  it('requires signing prerequisites for signed channel', () => {
    expectContains('name: Require signing prerequisites for signed channel');
    expectContains('test -n "${WIN_CSC_LINK}" && test -n "${WIN_CSC_KEY_PASSWORD}"');
    expectContains('test -n "${CSC_LINK}" && test -n "${CSC_KEY_PASSWORD}" && test -n "${APPLE_ID}" && test -n "${APPLE_APP_SPECIFIC_PASSWORD}" && test -n "${APPLE_TEAM_ID}"');
  });

  it('runs artifact audit gate for windows builds', () => {
    expectContains('name: Artifact audit gate');
    expectContains("if: matrix.platform_label == 'windows'");
    expectContains('run: npm run desktop:audit:artifact');
  });

  it('requires signed release channel for manual publish', () => {
    expectContains('release_channel:');
    expectContains("- 'unsigned'");
    expectContains("- 'signed'");
  });

  it('uploads build artifacts as CI outputs', () => {
    expectContains('uses: actions/upload-artifact@v4');
    expectContains('if-no-files-found: error');
  });

  it('defines publish-release job', () => {
    expectContains('publish-release:');
    expectContains('name: Publish GitHub Release');
  });

  it('gates publish-release on tag push or explicit workflow input', () => {
    expectContains("startsWith(github.ref, 'refs/tags/v') ||");
    expectContains("(github.event.inputs.publish_release == 'true' && github.event.inputs.release_channel == 'signed')");
  });

  it('grants contents:write permission for release publishing', () => {
    expectContains('permissions:');
    expectContains('contents: write');
  });

  it('downloads matrix artifacts before publishing release', () => {
    expectContains('uses: actions/download-artifact@v4');
    expectContains('path: release-artifacts');
  });

  it('publishes only signed macOS dmg and Windows exe artifacts', () => {
    expectContains('uses: softprops/action-gh-release@v2');
    expectContains('release-artifacts/desktop-macos-signed/*.dmg');
    expectContains('release-artifacts/desktop-windows-signed/*.exe');
  });
});
