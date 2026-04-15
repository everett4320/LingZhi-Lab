# Lingzhi Lab Custom 分支工作手册（Windows 打包与防逆向）

适用范围：
- 工作区：`C:\知域汇\lingzhi-lab-custom`
- 分支：`custom`
- 目标：仅记录 `custom` 分支特有策略，不回灌到 `main`。

## 1. Custom 分支特有约束

本分支是品牌定制分支，长期保持以下不变量：

1. 全库品牌与标识固定为 `lingzhi-lab` / `Lingzhi Lab`。
2. 禁止把 `dr-claw` / `drclaw` / `DrClaw` 重新引入本分支（包括代码、文档、文件名、目录名、默认路径）。
3. 工作区默认路径固定为 `~/lingzhi-lab` 与 `~/.lingzhi-lab`。
4. 从其他分支引入变更时，使用 `git cherry-pick -x <commit>`，不要直接 merge 分支。

推荐每次 cherry-pick 后执行：

```powershell
rg -n --hidden -S -i "dr[-_ ]?claw|drclaw|dr\.claw|dr\s+claw|DrClaw|DRCLAW"
rg --files --hidden | rg -n -i "dr[-_ ]?claw|drclaw|DrClaw|DRCLAW"
```

若有命中，必须在本次变更内清理后再继续。

## 2. Windows 打包现状（2026-04-14）

当前项目已有 Electron 打包链路：
- `npm run desktop:dist:win`（NSIS 安装包）
- 配置位于 `package.json` 的 `build.win.target = nsis`

本机当前状态（已打通）：
- 命令：`npm run desktop:dist:win`
- 产物：`release/Lingzhi Lab-1.1.4-win-x64.exe`
- 同步产物：`release/Lingzhi Lab-1.1.4-win-x64.exe.blockmap`、`release/latest.yml`

打通过程中的两个关键阻塞与处理：
1. `node-pty` Electron 重编译报 `MSB8040` / `SpectreMitigation=Disabled` 不兼容当前 MSVC：
   - 通过 `scripts/fix-node-pty.js` 增加 Windows 补丁，将 gyp 中 `SpectreMitigation: 'Disabled'` 替换为 `'false'`。
   - 在 `scripts/native-runtime.mjs` 的 Electron rebuild 前自动执行该补丁，避免手工修复。
2. `electron-builder` 默认 `winCodeSign-2.6.0.7z` 解压符号链接失败：
   - 当前策略改为 `build.win.signAndEditExecutable = false`，先确保产包稳定。
   - 同时保留 `signtoolOptions` 作为签名配置骨架，待后续证书与签名工具链确定后再开启签名执行。
3. 不同 Windows 机器差异导致的打包不稳定：
   - 在 `electron/cli.mjs` 增加“环境自适应打包”逻辑：
     - 自动探测当前机器是否支持符号链接；
     - 自动按探测结果注入 `--config.win.signAndEditExecutable=<true|false>`；
     - 自动探测本机 Windows Kits 下可用的最新 `signtool.exe` 并设置 `SIGNTOOL_PATH`；
     - 自动将 `ELECTRON_BUILDER_CACHE` 定位到项目内 `.electron-builder-cache`，降低不同机器/账户全局缓存污染。
   - 增加 `LINGZHI_WIN_SIGN_AND_EDIT_EXECUTABLE` 环境变量，可手动强制覆写自动决策。

## 3. Windows 打包落地步骤（可执行）

### 3.1 先修复构建机依赖

在 Visual Studio Installer 中补齐 Spectre 相关组件（按构建架构选择 x86/x64/ARM64）。

完成后验证：

```powershell
npm run desktop:dist:win
```

产物默认在：
- `release/*.exe`

### 3.2 CI 产物兜底

如果本地环境持续受限，优先使用仓库现有工作流构建 Windows 产物：
- `.github/workflows/desktop-release.yml`

建议将 `custom` 分支的 Windows 发布独立到自有 release channel，避免与 `main` 混淆。

## 4. 防逆向工程：现实边界与目标

必须明确：
- “绝对不可破解 / 无法还原任何代码”在客户端分发软件中不可保证。
- 可实现的是“显著提高逆向成本、降低自动化提取成功率、提高篡改难度”。

因此 `custom` 分支采用分层加固目标：让逆向成本高到不经济，而不是承诺数学意义上的“不可破解”。

## 5. 防逆向分层方案（Custom 专属）

### Layer A：发行与加载链路硬化（优先级 P0）

已在 `custom` 分支落地：
1. 开启并强制 `asar` 分发（`build.asar = true`）。
2. 启用 Electron Fuses（`build.electronFuses`）：
   - `runAsNode = true`（当前主进程通过 `ELECTRON_RUN_AS_NODE=1` 拉起本地 Node 服务，暂不能关闭）
   - `enableNodeOptionsEnvironmentVariable = false`
   - `enableNodeCliInspectArguments = false`
   - `onlyLoadAppFromAsar = true`
   - `enableEmbeddedAsarIntegrityValidation = true`
   - `enableCookieEncryption = true`
3. 增加 Windows 代码签名配置骨架（`win.signtoolOptions`）：
   - 时间戳服务器与 `sha256` 算法已配置；
   - 当前 `signAndEditExecutable = false`（为规避本机 winCodeSign 解压阻塞，先保证可稳定产包）。
4. 打包兼容性增强（偏流程，不改业务本体）：
   - 本地优先使用 `node_modules/.bin/electron-builder` / `node_modules/.bin/electron-rebuild`，避免 `npx` 在部分终端环境的 `ENOENT` 问题；
   - Windows 打包时动态决定签名编辑开关并打印决策日志，方便 CI/本机排障。

待下一阶段（证书/签名基础设施就绪）再切换：
- `win.signAndEditExecutable` 从 `false` 改回 `true`；
- 对接 `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD`（或企业签名服务）并在 CI 验证。

### Layer B：代码可读性对抗（优先级 P1）

1. 对 renderer 产物做选择性混淆（关键模块，不全量盲混淆）。
2. 对关键 main/preload 逻辑做 Bytenode 字节码化（仅高价值模块）。
3. 将敏感常量切分并运行时拼装，避免明文常量集中暴露。

### Layer C：反篡改与运行时检测（优先级 P1）

1. 增加包体完整性与关键文件哈希校验。
2. 检测常见调试/注入环境并降级敏感功能。
3. 所有授权与高价值判定尽量服务端化，客户端只做展示与临时令牌消费。

### Layer D：运维与追踪（优先级 P2）

1. 为打包产物建立版本级 hash 清单。
2. 建立异常启动/篡改信号上报（不含敏感隐私）。
3. 定期红队化自测（脚本化解包、静态分析、注入回归）。

## 6. GitHub 调研结论（可复用仓库）

可直接参考并评估接入：

1. `electron/fuses`：构建期 fuse 翻转工具，官方推荐路径。  
   https://github.com/electron/fuses
2. `electron-userland/electron-builder`：当前项目已在使用的打包框架。  
   https://github.com/electron-userland/electron-builder
3. `bytenode/bytenode`：Node/Electron 字节码编译方案。  
   https://github.com/bytenode/bytenode
4. `javascript-obfuscator/javascript-obfuscator`：JS 混淆方案（需权衡性能与体积）。  
   https://github.com/javascript-obfuscator/javascript-obfuscator
5. `sleeyax/asarmor`：ASAR 加固思路参考（用于评估，不建议盲信“防提取”宣传）。  
   https://github.com/sleeyax/asarmor

关键事实参考：

1. Electron 官方文档说明 ASAR 主要是打包与“cursory inspection”级别隐藏，不等同强加密。  
   https://www.electronjs.org/docs/latest/tutorial/asar-archives
2. `electron/asar` 的“加密功能”历史提案已关闭（not planned）。  
   https://github.com/electron/asar/issues/46
3. Electron 官方 Fuses 文档明确其安全价值在于关闭不必要高危入口。  
   https://www.electronjs.org/docs/tutorial/fuses
4. Windows `MSB8040` 官方说明：缺 Spectre 库时会失败，需安装匹配组件或关闭相关选项。  
   https://learn.microsoft.com/en-us/visualstudio/msbuild/errors/msb8040

## 7. 建议的实施节奏（Custom）

1. 先打通构建：修复 `MSB8040`，确保 `desktop:dist:win` 稳定产包。
2. 再做 P0 硬化：`asar + fuses + 代码签名`。
3. 然后做 P1：关键模块字节码化 + 选择性混淆 + 反篡改。
4. 最后做 P2：监控、审计、红队化回归。

## 8. CI 阻断门禁与双通道签名（2026-04-15）

### 8.1 可构建 vs 可发布

- 可构建（unsigned channel）：
  - 目标：保证开发/联调和兼容性排障不被证书条件阻塞。
  - 允许无证书构建产物，但不用于正式发布。
- 可发布（signed channel）：
  - 目标：用于 tag/release 的正式分发通道。
  - 必须通过签名前置条件校验；签名失败即失败，不回落 unsigned。

### 8.2 Workflow 执行规则

`desktop-release.yml` 按 `release_channel` 分流：

1. unsigned：默认手动构建通道。
2. signed：tag 场景或手动显式指定 `release_channel=signed` 时启用。

`publish-release` 仅消费 `*-signed` 产物，不消费 unsigned 产物。

### 8.3 阻断式 Gate

构建前 gate（必须通过）：

- `desktop-package-config`
- `desktop-runtime-robustness`
- `desktop-security-hardening`
- `desktop-workflow-contract`

构建后 gate（Windows，必须通过）：

- `npm run desktop:prune:unpacked`
- `npm run desktop:audit:artifact`

audit 默认拒绝以下泄露项（在 `release/win-unpacked/resources/app.asar.unpacked` 下扫描）：

- `*.map`
- `*.test.*`
- `src/**/*.ts`

命中即 exit code 非零并阻断上传与发布。

### 8.4 例外申请原则

如确需放行某个文件，必须同时满足：

1. 记录到 `packaging/audit-desktop-artifact.mjs` allowlist（最小粒度、精确路径）。
2. 在 packaging 测试中增加对应契约，说明放行原因与边界。
3. 在本手册记录该例外的到期复核计划（避免例外长期沉积）。

---

维护原则：
- 此文档是 `custom` 分支治理基线；后续任何来自 `main` 或其他 topic 的引入，均应先 cherry-pick，再按本手册做品牌与安全回归检查。
