# Windows 本地安装与运行日志（复用手册）

适用目录：`C:\知域汇\lingzhi-lab-custom-bridge`

## 1. 本地安装版本约定（线性唯一）

- 本地安装目录固定为：`%LOCALAPPDATA%\Programs\lingzhi-lab`
- 每次执行 `npm run desktop:fresh:win` 时，流程会：
  1. 先结束旧进程
  2. 清理旧安装目录
  3. 部署新打包产物
  4. 验证启动并自动打开
- 结论：本机只保留一个已安装版本，不会并存多个版本。

## 2. 推荐执行命令

```powershell
npm run desktop:fresh:win
```

该命令会完成：

- `desktop:dist:win` 打包
- 清理旧版并安装新版
- 桌面快捷方式更新
- 启动验证（存活 + 健康检查）
- 最终自动打开应用

## 3. 日志写入位置

用户数据目录（Windows）：

```text
%APPDATA%\Lingzhi Lab
```

关键日志：

- 全量汇总日志：`%APPDATA%\Lingzhi Lab\desktop.log`
- 单次运行日志目录：`%APPDATA%\Lingzhi Lab\run-logs`
- 单次运行日志文件：`desktop-run-<timestamp>-pid<pid>.log`

日志保留策略（自动清理）：

- 最多保留最近 40 份运行日志
- 或最多保留 14 天

## 4. 如何读取日志

### 4.1 图形界面（推荐）

应用菜单 `Help`：

- `View Current Run Log`：打开当前这次运行的日志文件位置
- `Open Logs Folder`：打开 `run-logs` 目录

### 4.2 PowerShell 查看最新运行日志

```powershell
$dir = Join-Path $env:APPDATA 'Lingzhi Lab\run-logs'
$latest = Get-ChildItem -LiteralPath $dir -Filter 'desktop-run-*.log' |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
$latest.FullName
```

### 4.3 实时跟踪（复现问题时）

```powershell
Get-Content -LiteralPath $latest.FullName -Wait
```

### 4.4 只看最后 200 行

```powershell
Get-Content -LiteralPath $latest.FullName -Tail 200
```

## 5. 日志内容范围

单次运行日志会记录（JSON 行格式）：

- 主进程启动与关键上下文（runId、pid、路径）
- 服务端启动参数与 `stdout/stderr`
- 渲染进程崩溃、未响应、恢复
- 渲染层错误（`window.error` / `unhandledrejection`）
- 渲染层 `console.error` / `console.warn`
- 网络请求错误事件（Electron session webRequest）
- 前端 `fetch`：开始/结束/耗时/状态码/异常/超时
- 前端 `XMLHttpRequest`：open/send/finish/error/timeout/abort
- 前端 `WebSocket`：创建、连接、发送、接收、关闭、异常
- 前端 IPC（`ipcRenderer.invoke`）：开始/结束/异常/超时（用于定位“函数无回复”）
- 网络状态与链路质量：`online/offline`、`navigator.connection` 变化（如 `effectiveType`、`rtt`、`downlink`）
- 服务端 HTTP：每个请求的开始/完成/关闭/慢请求告警
- 服务端出站请求：Node `fetch` 与 `http/https` 请求的耗时与错误

## 6. 可调日志开关（按需）

默认已经开启详细追踪。可通过环境变量调节：

- `LINGZHI_HTTP_TRACE=0`：关闭服务端 HTTP/出站请求追踪（默认开启）
- `LINGZHI_HTTP_TRACE_MAX_BODY_CHARS=4000`：请求体日志最大字符数
- `LINGZHI_HTTP_TRACE_SLOW_WARN_MS=15000`：慢请求告警阈值（毫秒）
- `LINGZHI_SERVER_FETCH_TIMEOUT_MS=45000`：服务端 `fetch` 超时（毫秒）
- `LINGZHI_LOG_HIDE_HIGH_VOLUME_EVENTS=1`：控制台隐藏高频日志，仅保留到文件

## 7. 提交问题时的最小材料

当你反馈“这次运行有问题”时，建议一起提供：

1. 出问题的大致时间（本地时区）
2. 当前运行日志文件（`desktop-run-...log`）
3. `desktop.log` 最后 200 行
4. 截图或复现步骤（越短越好）
