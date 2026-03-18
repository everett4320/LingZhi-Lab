<div align="center">
  <img src="public/dr-claw.png" alt="Dr. Claw" width="128" height="128">
  <h1>Dr. Claw: 面向科研全流程的通用 AI 研究助手</h1>
  <p><strong>在一个工作区里完成研究规划、执行与写作。</strong></p>
</div>

<p align="center">
<a href="https://github.com/OpenLAIR/dr-claw">
<img src="https://img.shields.io/badge/%F0%9F%A6%9E-Dr.%20Claw-CB2B3E?style=for-the-badge" alt="Dr. Claw" />
</a>
<a href="https://github.com/OpenLAIR/dr-claw/blob/main/LICENSE">
<img src="https://img.shields.io/badge/License-GPL--3.0%20%2B%20AGPL--3.0-blue?style=for-the-badge" alt="License: GPL-3.0 + AGPL-3.0" />
</a>
<a href="https://join.slack.com/t/vibe-lab-group/shared_invite/zt-3r4bkcx5t-iGyRMI~r09zt7p_ND2eP9A">
<img src="https://img.shields.io/badge/Join-Slack-4A154B?style=for-the-badge&logo=slack" alt="Join Slack" />
</a>
<a href="https://x.com/Vibe2038004">
<img src="https://img.shields.io/badge/Follow-on%20X-black?style=for-the-badge&logo=x" alt="Follow on X" />
</a>
<a href="./public/wechat-group-qr.jpg">
<img src="https://img.shields.io/badge/%E5%8A%A0%E5%85%A5-%E5%BE%AE%E4%BF%A1%E7%BE%A4-07C160?style=for-the-badge&logo=wechat&logoColor=white" alt="加入微信群" />
</a>
</p>

<p align="center">
  <a href="./README.md">English</a> | <a href="./README.zh-CN.md">中文</a>
</p>

## 目录

- [Overview](#overview)
- [亮点](#亮点)
- [快速开始](#快速开始)
- [配置说明](#配置说明)
- [Research Lab - 快速示例](#research-lab-quick-example)
- [使用指南](#使用指南)
- [补充说明](#补充说明)
- [贡献](#贡献)
- [FAQ](./docs/faq.zh-CN.md)
- [许可证](#许可证)
- [致谢](#致谢)
- [支持与社区](#支持与社区)

## Overview

Dr. Claw 是一个面向不同研究方向的通用 AI 研究助手，帮助研究者和团队完成从想法形成、实验推进到论文产出的全流程工作。它把关键研究环节整合到同一个空间中，让你把精力放在问题本身和迭代质量上，而不是工具切换与流程拼接。

<details>
<summary><strong>产品截图</strong></summary>

<p align="center">
  <img src="public/screenshots/chat.png" alt="Dr. Claw 对话界面" width="1000">
</p>

</details>

<details>
<summary><strong>理念：杠杆化认知</strong></summary>

<p align="center">
  <img src="public/leveraged-cognition.png" alt="Leveraged Cognition" width="900">
</p>

**纯手工太慢，完全交给 AI 又太平庸，Vibe Researching 才是新的范式。** Dr. Claw 以 **Agentic Execution** 放大你的 **Research Taste**，让你既能更快推进、更大胆探索，也始终守住科研严谨性的底线。

</details>

## 亮点

- **🔬 Research Lab** — 端到端研究仪表盘：定义研究简报、生成任务流水线、追踪 Survey → Ideation → Experiment → Publication → Promotion 各阶段进度，一览参考论文、Idea（支持 LaTeX 数学公式渲染）和缓存产物
- **⚡ Auto Research** — 可直接从 Project Dashboard 一键顺序执行研究任务，实时打开对应 session，并在运行完成后发送邮件通知
- **📚 100+ Research Skills** — 覆盖 Idea 生成、代码调研、实验开发与分析、论文写作、审阅回复与交付的技能库 — Agent 自动发现并作为任务级辅助
- **🗂️ 对话驱动的 Pipeline** — 在 Chat 中描述你的研究想法，Agent 使用 `inno-pipeline-planner` skill 交互式生成结构化研究简报和任务列表 — 无需手动选择模板
- **🤖 多 Agent 后端** — 可在 Claude Code、Gemini CLI 和 Codex 之间切换作为执行引擎

<details>
<summary><span style="font-size: 1.17em; font-weight: 600;">更多功能</span></summary>

- **💬 交互式 Chat + Shell** — 与 Agent 对话或直接进入终端 — 与研究上下文并排使用
- **📁 文件 & Git 浏览器** — 语法高亮浏览文件、实时编辑、暂存变更、提交和切换分支，无需离开 UI
- **📱 响应式 & PWA 就绪** — 桌面、平板和移动端布局，底部选项卡栏、滑动手势和添加到主屏幕支持
- **🔄 会话管理** — 恢复对话、管理多个会话，跨项目追踪完整历史

</details>

### 功能截图

<details>
<summary><strong>展开查看截图</strong></summary>

<p><strong>Project Dashboard</strong> — 从项目总览进入，查看状态并启动端到端自动化流程。</p>
<p align="center">
  <img src="public/screenshots/project_dashboard.png" alt="项目看板界面" width="1000">
</p>

<p><strong>Skill Library</strong> — 浏览覆盖想法生成、实验推进与论文写作的技能库。</p>
<p align="center">
  <img src="public/screenshots/skill_library.png" alt="技能库界面" width="1000">
</p>

<p><strong>News Dashboard</strong> — 在同一工作区内跟踪研究相关的资讯更新。</p>
<p align="center">
  <img src="public/screenshots/news_dashboard.png" alt="新闻看板界面" width="1000">
</p>

</details>


## 快速开始

### 前置要求

- [Node.js](https://nodejs.org/) v20 或更高版本（**推荐 v22 LTS**，见 `.nvmrc`）
- 至少安装并配置以下 CLI 工具之一：
  - [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)
  - [Gemini CLI](https://geminicli.com/docs/get-started/installation/)
  - [Codex CLI](https://developers.openai.com/codex/cli/)
- 部分系统需要原生构建工具来安装 `node-pty`、`better-sqlite3` 等依赖；如果 `npm install` 失败，请查看 [FAQ](docs/faq.zh-CN.md)。

Cursor Agent 支持正在开发中，即将推出。

### 安装

1. **克隆仓库：**
```bash
git clone https://github.com/OpenLAIR/dr-claw.git
cd dr-claw
```

2. **安装依赖：**
```bash
npm install
```

3. **配置环境：**
```bash
cp .env.example .env
# 编辑 .env 文件，设置端口等偏好配置
```

如需自定义端口、认证或工作区设置，请参阅 [docs/configuration.zh-CN.md](docs/configuration.zh-CN.md)。

4. **启动应用：**
```bash
# 开发模式（支持热重载）
npm run dev
```

5. **打开浏览器** 访问 `http://localhost:5173`（或您在 `.env` 中配置的端口）

如果后续 Agent 网页搜索不可用，请查看下方的**网页搜索排障**。

## 配置说明

Dr. Claw 会从 `.env` 读取本地配置。对大多数用户来说，只需要把 `.env.example` 复制为 `.env`；但以下几个配置项最常需要尽早调整：

- `PORT`：后端服务端口
- `VITE_PORT`：前端开发服务器端口
- `HOST`：前后端服务绑定地址
- `JWT_SECRET`：当你要把 Dr. Claw 暴露到 localhost 之外时必须设置
- `WORKSPACES_ROOT`：新项目工作区的默认根目录

完整环境变量说明和部署注意事项见 [docs/configuration.zh-CN.md](docs/configuration.zh-CN.md)。

Auto Research 的邮件通知配置在应用内的 **Settings → Email**。当前 v1 支持 Claude Code、Codex、Gemini 作为执行引擎进行无人值守研究任务执行；如果运行中断，系统会自动回收僵尸 run，避免其长期停留在 `running` 状态。

<a id="research-lab-quick-example"></a>

## Research Lab — 快速示例

Dr. Claw 的核心功能是 **Research Lab**。

<details>
<summary><strong>Research Lab 截图</strong></summary>

<p align="center">
  <img src="public/screenshots/research_lab.png" alt="Research Lab 工作流" width="1000">
</p>

</details>

典型流程如下：

1. 在 **Settings** 中配置一个受支持的 Agent。
2. 如果希望收到完成通知，在 **Settings → Email** 中配置邮件信息。
3. 在 **Chat** 中描述你的研究想法。
4. 让 Agent 生成 `.pipeline/docs/research_brief.json` 和 `.pipeline/tasks/tasks.json`。
5. 在 **Research Lab** 中查看流水线，并把任务发送回 **Chat** 执行，或者在 Project Dashboard 上点击 **Auto Research** 让系统顺序执行全部任务。

完整操作步骤请见下方 **使用指南**。

## 使用指南

启动 Dr. Claw 后，打开浏览器并按以下步骤操作。

<details>
<summary><strong>第 1 步 — 创建或打开项目</strong></summary>

首次打开 Dr. Claw 时，您会看到 **Projects** 侧边栏。您有两种选择：

- **打开已有项目** — Dr. Claw 会自动发现已注册项目，以及来自 Claude Code、Codex、Gemini 的关联会话。
- **创建新项目** — 点击 **"+"** 按钮，选择本机的一个目录，Dr. Claw 会创建：`.claude/`、`.agents/`、`.gemini/` 等 Agent 目录、标准工作区元数据、链接的 `skills/` 目录、预设研究目录（`Survey/references`、`Survey/reports`、`Ideation/ideas`、`Ideation/references`、`Experiment/code_references`、`Experiment/datasets`、`Experiment/core_code`、`Experiment/analysis`、`Publication/paper`、`Promotion/homepage`、`Promotion/slides`、`Promotion/audio`、`Promotion/video`），以及项目根目录下的 **instance.json**（上述目录的绝对路径写入其中）。Cursor Agent 支持即将推出。

> **默认项目存储路径：** 新项目默认存储在 `~/dr-claw` 目录下。可在 **Settings → Appearance → Default Project Path** 中修改，也可通过环境变量 `WORKSPACES_ROOT` 设置。该配置持久化在 `~/.claude/project-config.json` 中。

</details>

<details>
<summary><strong>第 2 步 — 通过 Chat 生成研究流水线</strong></summary>

创建或打开项目后，Dr. Claw 默认进入 **Chat** 页面。如果尚未生成研究流水线，页面会显示引导提示，并提供 **Use in Chat** 按钮注入模板提示。

<details>
<summary><strong>Chat 截图</strong></summary>

<p align="center">
  <img src="public/screenshots/chat.png" alt="Chat 界面" width="1000">
</p>

</details>

描述你的研究想法 — 即使只是一个大概的方向也可以。Agent 会使用 `inno-pipeline-planner` skill 与你交互，然后生成：
- `.pipeline/docs/research_brief.json`（结构化研究简报）
- `.pipeline/tasks/tasks.json`（任务流水线）

</details>

<details>
<summary><strong>第 3 步 — 在 Research Lab 查看并执行任务</strong></summary>

切换到 **Research Lab** 查看生成的任务、进度指标和研究产物，然后执行任务：

<details>
<summary><strong>任务执行截图</strong></summary>

<p align="center">
  <img src="public/screenshots/task_list.png" alt="任务列表与执行流程" width="1000">
</p>

</details>

1. 通过 **CLI 选择器** 选择后端（Claude Code、Gemini CLI 或 Codex）。
2. 在 **Research Lab** 中对 pending 任务点击 **Go to Chat** 或 **Use in Chat**。
3. Agent 执行任务并将结果写回项目。

</details>

<details>
<summary><strong>可选项 — 在 Project Dashboard 中运行 Auto Research</strong></summary>

如果你希望 Dr. Claw 端到端自动执行整条任务流水线，可以使用 **Auto Research**：
1. 打开 **Settings → Email**，配置 `Notification Email`、`Sender Email` 和 `Resend API Key`。
2. 确认项目中已经存在 `.pipeline/docs/research_brief.json` 和 `.pipeline/tasks/tasks.json`。
3. 打开 **Project Dashboard**，在项目卡片上点击 **Auto Research**。
4. 点击 **Open Session** 可随时跳转到本次运行创建的 Claude session。
5. 所有任务完成后，Dr. Claw 会发送完成通知邮件；如果 session 中途被打断，系统会自动恢复 stale run，避免它一直卡在 `running` 状态。

</details>

<details>
<summary><strong>第 4 步 — 网页搜索排障</strong></summary>

如果 Agent 不能搜索网页，通常是当前权限设置过于严格。除此之外，也需要确认当前进程是否仍然启用了运行时网络锁。

1. 检查运行时网络锁：
```bash
echo "${CODEX_SANDBOX_NETWORK_DISABLED:-0}"
```

如果输出为 `1`，即使在 Settings 中放宽权限，网络请求仍可能被阻止。需要在部署或启动层（shell profile、systemd、Docker、PM2）移除或覆盖该变量，然后重启 Dr. Claw。

2. 打开 **Settings**（侧边栏齿轮图标）。
3. 进入 **Permissions**，然后选择当前使用的 Agent：
- **Claude Code**：
  - 在 **Allowed Tools** 中允许 `WebSearch`、`WebFetch`。
  - 确认这两个工具不在 **Blocked Tools** 中。
  - 若希望减少确认弹窗，可开启 **Skip permission prompts**。
- **Gemini CLI**：
  - 选择合适的 **Permission Mode**。
  - 若需要网页访问，在 **Allowed Tools** 中允许 `google_web_search` 与 `web_fetch`。
  - 确认它们不在 **Blocked Tools** 中。
- **Codex**：
  - 在 **Permission Mode** 中切换到 **Bypass Permissions**（在需要网页访问时）。
4. 返回 **Chat**，发送新消息并重新尝试网页搜索。

Codex 权限模式说明：
- **Default / Accept Edits**：仍是沙箱执行，网络可能继续受会话策略限制。
- **Bypass Permissions**：`sandboxMode=danger-full-access`，具有完整磁盘与网络访问权限。

安全提示：
- 仅在可信项目/环境中使用更宽松的权限设置。
- 完成网页搜索后，建议切回更安全的设置。

</details>

<details>
<summary><strong>第 5 步 — 解决"Workspace Trust"或首次运行错误</strong></summary>

每个 Agent 首次在项目目录中执行代码时，可能需要进行一次性的信任确认或登录。如果 Chat 窗口卡住或弹出信任/认证提示，请切换到 Dr. Claw 内置的 **Shell** 标签页，在那里同意提示即可。

操作步骤：
1. 切换到 Dr. Claw 的 **Shell** 标签页。
2. 在 Shell 中同意 trust/auth 提示。
3. 返回 **Chat** 重新发送消息即可。

Dr. Claw 默认已经开启 trust 流程，因此通常**不需要**再手动输入额外的 trust 指令。

信任状态按目录持久保存，每个项目只需操作一次。

> **Shell 标签页无法使用？** 如果 Shell 标签页报 `Error: posix_spawnp failed`，请参阅 [docs/faq.zh-CN.md](docs/faq.zh-CN.md) 中的修复方法，然后重试。

您也可以随时切换到其他标签页：

| 标签页 | 功能说明 |
|--------|----------|
| **Chat** | 从这里开始。用它描述研究想法、生成流水线，并用所选 Agent 执行任务。 |
| **Survey** | 查看当前项目的论文、文献图谱、笔记和调研阶段任务。 |
| **Research Lab** | 在一个视图里查看研究简报、任务列表、进度和已生成的产物。 |
| **Skills** | 浏览已安装的 Skills，查看内容，并导入本地 Skills。 |
| **Compute** | 在一个位置管理计算资源并运行实验工作负载。 |
| **Shell** | 需要直接使用 CLI、处理 trust 提示或手动执行命令时，使用内置终端。 |
| **Files** | 浏览、打开、创建、重命名和编辑项目文件，并支持语法高亮。 |
| **Git** | 不离开应用即可查看差异、暂存更改、提交和切换分支。 |

</details>

<details>
<summary><strong>研究技能（Skills）</strong></summary>

Dr. Claw 当前以生成后的 **Pipeline Task List** 作为执行流水线。
项目内置了 **100+ 个 skills**（位于 `skills/`），用于辅助科研任务，包括 idea 探索、代码调研、实验开发/分析、论文写作、审阅与交付等。
Agent 会自动发现这些 skills，并在任务执行过程中按需调用。

</details>

## 补充说明
<details>
<summary><span style="font-size: 1.17em; font-weight: 600;">移动端、架构与安全配置</span></summary>

### 移动端与平板

Dr. Claw 完全响应式设计。在移动设备上：

- **底部选项卡栏** — 方便拇指操作
- **滑动手势** — 触摸优化的控制方式
- **添加到主屏幕** — 可作为 PWA（渐进式 Web 应用）使用

### 架构

#### 系统概览

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │   Backend       │    │  Agent     │
│   (React/Vite)  │◄──►│ (Express/WS)    │◄──►│  Integration    │
│                 │    │                 │    │                │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

#### 后端 (Node.js + Express)
- **Express 服务器** - 具有静态文件服务的 RESTful API
- **WebSocket 服务器** - 用于聊天和项目刷新的通信
- **Agent 集成 (Claude Code、Gemini CLI、Codex)** - 负责进程拉起、流式输出与会话管理
- **文件系统 API** - 为项目公开文件浏览器

#### 前端 (React + Vite)
- **React 18** - 带有 hooks 的现代组件架构
- **CodeMirror** - 具有语法高亮的高级代码编辑器

### 安全与工具配置

**🔒 重要提示**: 各 Agent 的权限都是按提供方独立配置的。在开启宽松的文件、Shell 或网页访问前，请先检查 **Settings → Permissions**。

#### 启用工具

为了安全地使用网页搜索和高权限工具：

1. **打开 Settings** - 点击侧边栏中的齿轮图标
2. **选择 Agent** - Claude Code、Gemini CLI 或 Codex
3. **按需启用** - 仅开启当前任务需要的工具或权限模式
4. **应用设置** - 您的偏好设置将保存在本地

**推荐方法**: 优先使用最保守的权限模式，只在确实需要时放宽配置。

</details>

## 贡献
<details>
<summary><span style="font-size: 1.17em; font-weight: 600;">展开内容</span></summary>

我们欢迎贡献！请遵循以下指南：

#### 入门
1. **Fork** 仓库
2. **克隆** 您的 fork：`git clone <your-fork-url>`
3. **安装** 依赖：`npm install`
4. **创建** 特性分支：`git checkout -b feature/amazing-feature`

#### 开发流程
1. **进行更改**，遵循现有代码风格
2. **彻底测试** - 确保所有功能正常工作
3. **运行质量检查**：`npm run typecheck && npm run build`
4. **提交**，遵循 [Conventional Commits](https://conventionalcommits.org/) 的描述性消息
5. **推送** 到您的分支：`git push origin feature/amazing-feature`
6. **提交** 拉取请求，包括：
   - 更改的清晰描述
   - UI 更改的截图
   - 适用时的测试结果

#### 贡献内容
- **错误修复** - 帮助我们提高稳定性
- **新功能** - 增强功能（先在 issue 中讨论）
- **文档** - 改进指南和 API 文档
- **UI/UX 改进** - 更好的用户体验
- **性能优化** - 让它更快

</details>

安装与故障排除请参阅 [FAQ](docs/faq.zh-CN.md)。

## 许可证

本仓库包含一个组合作品。

其中，源自 Claude Code UI 的上游部分继续适用 GNU General Public License v3.0（GPL-3.0）；Dr. Claw Contributors 的原创修改与新增部分适用 GNU Affero General Public License v3.0（AGPL-3.0）。

完整许可证文本与适用范围说明请参见 [LICENSE](LICENSE) 和 [NOTICE](NOTICE)。

## 致谢

### 构建工具
- **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** - Anthropic 的官方 CLI
- **[Gemini CLI](https://geminicli.com/docs/get-started/installation/)** - Google 的 Gemini 命令行智能体
- **[Codex](https://developers.openai.com/codex)** - OpenAI Codex
- **[React](https://react.dev/)** - 用户界面库
- **[Vite](https://vitejs.dev/)** - 快速构建工具和开发服务器
- **[Tailwind CSS](https://tailwindcss.com/)** - 实用优先的 CSS 框架
- **[CodeMirror](https://codemirror.net/)** - 高级代码编辑器

### 致谢与参考
- **[Claude Code UI](https://github.com/siteboon/claudecodeui)** — Dr. Claw 基于此项目。详见 [NOTICE](NOTICE)。
- **[AI Researcher](https://github.com/HKUDS/AI-Researcher/)**（HKUDS）— 研究流程与智能体研究灵感致谢与参考。

## 支持与社区

### 保持更新
- **Star** 此仓库以表示支持
- **Watch** 以获取更新和新版本
- **Follow** 项目以获取公告

---

<div align="center">
  <strong>Dr. Claw — 从想法到论文。</strong>
</div>
