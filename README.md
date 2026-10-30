# DSH 任务完成提醒（dsh-completion-notifier）

[English](#english) | 中文

DeepSeek Harness（DSH）插件：**对话任务完成时播放提示音，并弹出 Windows 通知。**

仓库：<https://github.com/bgmmd/dsh-completion-notifier>

## 功能

- 一轮对话真正完成时（会话日志提交 `turn/end`，原因为 `completed`）触发一次提醒。
- 用户取消、出错、达到 token 上限的回合**不会**误报。
- 只提醒顶层会话（你自己打开的对话）；子代理、团队成员的临时回合默认不提醒。
- Windows Toast 通知 + 提示音；WinRT 不可用时自动回退为托盘气泡通知。
- 声音文件、通知文案、去抖间隔等都可配置。
- 不阻塞 Agent 工作：PowerShell 助手在后台异步执行。

## 环境要求

- **Windows 10 / 11**
- DSH `>= 0.2.1-rc.3 < 0.3.0`（见 `package.json` 的 `engines.dsh`）
- 通知归属的 AppID 默认为 DeepSeek Harness 桌面版的 `com.deepseek.dsh`；
  其他安装方式可用 `aumid` 配置项覆盖（WinRT 失败会自动回退气泡通知）。

## 安装

### 方式一：DSH Web 界面

1. 侧边栏 **Plugins** → **Add plugin**（或 **Install a third-party plugin**）；
2. 粘贴下面的 Git 地址（建议固定 commit，避免分支变动）：

   ```text
   git+https://github.com/bgmmd/dsh-completion-notifier.git#<commit>
   ```

3. 勾选信任说明并安装。

### 方式二：让 Agent 安装

```text
plugin_manager install_bundle target=git+https://github.com/bgmmd/dsh-completion-notifier.git#<commit>
```

### 方式三：本地目录（开发用）

```text
plugin_manager install_bundle target=<本包绝对路径>
```

安装后立即对所有会话生效。当前 DSH 版本没有插件升级操作，更新版本 = 卸载后重新安装新 commit。

## 工作方式

- 监听 Host 的 `session/event`，在 `turn/end` 且 `reason.kind === "completed"` 时触发；
- 通过 `ctx.agents.roots()` 过滤掉非顶层 Agent；
- 调用包内 `notify-windows.ps1`：WinRT Toast 优先，失败回退托盘气泡；随后播放 WAV 提示音；
- 通知默认静音系统音（`muteToastSound`），避免与自定义提示音重复。

## 配置

在用户补丁层 `%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml` 末尾追加 id 覆盖
（推荐，源码升级不丢配置；保存后通常由配置热更新生效）：

```yaml
- id: completion-notifier
  name: '@local/completion-notifier'
  config:
    soundFile: 'C:\Windows\Media\chimes.wav'
```

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 总开关 |
| `toast` | `true` | 是否弹出 Windows 通知 |
| `sound` | `true` | 是否播放提示音 |
| `soundFile` | `C:\Windows\Media\notify.wav` | 提示音 WAV 路径，缺失时回退到该默认文件 |
| `muteToastSound` | `true` | 静音通知自带系统音，避免与提示音重复 |
| `aumid` | `com.deepseek.dsh` | 通知归属的应用 AppID |
| `onlyRootAgents` | `true` | 只提醒顶层会话 |
| `minIntervalMs` | `1500` | 两条通知的最小间隔（毫秒），用于去抖 |
| `title` | `任务完成` | 通知标题模板 |
| `body` | `对话已完成，可以回来查看了 · 用时 {duration}` | 通知正文模板 |
| `logFile` | `""` | 记录 PowerShell 助手结果的文件；为空则不记录 |

模板占位符：`{duration}`（本轮用时）、`{session}`（会话 ID 前 8 位）、
`{time}`（完成时刻）、`{topic}`（会话标题，若已生成）。

常用音效：`C:\Windows\Media\notify.wav`、`chimes.wav`、`ding.wav`、`tada.wav`。

## 卸载

Plugins 页面移除插件包，或：

```text
plugin_manager remove_bundle target=@local/completion-notifier
```

## 开发说明

- 包名 `@local/completion-notifier` 是本地占位名；若发布到 npm / 插件市场，需要改成
  公开合法包名并去掉 `"private": true`。
- 插件是纯 JS、无构建步骤；修改 `index.js` / `notify-windows.ps1` 后在 Plugins 页面
  禁用再启用（或重启 DSH）即可加载新代码。
- `notify-windows.ps1` 只使用 Windows 自带 PowerShell 5.1 与系统组件，不依赖第三方模块。

<a id="english"></a>
## English

A DeepSeek Harness (DSH) plugin that plays a chime and shows a Windows toast notification
when a conversation turn completes.

- Triggers on the durable `turn/end` session event with reason `completed` only;
  cancelled, errored, and max-token turns do not notify.
- Top-level Agents only (subagents and teammates are ignored by default).
- WinRT toast with tray-balloon fallback; notification sound is configurable.
- Windows 10/11 only; requires DSH `>= 0.2.1-rc.3 < 0.3.0`.
- Install from Git:

  ```text
  git+https://github.com/bgmmd/dsh-completion-notifier.git#<commit>
  ```
