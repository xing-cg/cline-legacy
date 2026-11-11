# Cline 4.0.12 — 固定版本与内网环境维护分支

本分支基于上游 **Cline v4.0.12**（`f267bf47e394e2c38f8b321c973a8d5867a14cd5`），面向无法持续升级的开发环境：固定 VS Code 1.95.3、通过 Remote SSH 连接 CentOS 7 / glibc 2.17、离线安装扩展，以及直接接入内部或第三方模型网关。

这是社区维护的源码修改，不是 Cline 官方发行版。保留上游 Apache-2.0 许可证与版权声明。扩展版本保持 **4.0.12**；维护批次通过 Git 提交、制品文件名和校验值区分。

## 为什么基于 4.0.12

旧环境的问题不只是模型列表过时：操作系统、远程 VS Code Server、扩展的最低编辑器版本和企业升级流程可能同时受到限制。让用户为了增加一个模型而升级整套环境，往往不可行。本分支把需要经常变化的连接和模型信息变成可配置项，并修复已确认的旧版问题。

| 边界 | 官方依据与本分支选择 |
| --- | --- |
| Cline 4.0.12 | [扩展清单](https://github.com/cline/cline/blob/v4.0.12/apps/vscode/package.json)要求 VS Code `^1.84.0`，包含 1.95.3。 |
| Cline 4.1.0 | [扩展清单](https://github.com/cline/cline/blob/v4.1.0/apps/vscode/package.json)要求 `^1.101.0`；[发布说明](https://github.com/cline/cline/releases/tag/v4.1.0)介绍了新的双 bundle 发布结构。因此本分支固定在切换前的 legacy 基线。 |
| CentOS 7 / glibc 2.17 | 微软从 [VS Code 1.99](https://code.visualstudio.com/updates/v1_99#_linux-legacy-server-support-has-ended) 起要求预构建 Linux Server 使用 glibc 2.28 或更新版本。固定 1.95.3 是目标环境选择，不表示它是 glibc 2.17 能使用的最高 VS Code 版本。 |

扩展清单兼容不等于每项功能都已在 CentOS 7 实机验证。终端、搜索、检查点、MCP 和浏览器工具各有运行时依赖；参见[验证与安装记录](docs/legacy-maintenance.md)。本项目不通过修改清单绕过新版本的系统要求，也不承诺兼容所有上游新增功能。

## 本分支的改进

* **按需获取模型列表**：OpenAI Compatible 与 Anthropic 设置中提供明确的获取按钮、加载状态、模型下拉和错误提示。请求由扩展宿主发起，支持手填模型 ID；不会在输入地址或 Key 时自动请求。模型列表不提供上下文等信息时，保留用户手动设置。
* **可维护的 Anthropic 自定义模型**：允许新模型 ID 原样传给服务商，配套可编辑的上下文、输出长度及工具能力，避免未知 ID 静默回退到内置默认模型。包含此前 Sonnet 5.5 请求参数与 thinking 签名兼容修正。
* **尊重设置的上下文窗口**：移除 OpenAI Compatible 对名称含 `deepseek` 的模型强制设为 128k 的旧逻辑。旧逻辑会让界面填了 1M 的请求仍在约 98k 触发压缩。保留自动压缩及预留空间机制；服务商的实际容量仍是上限。
* **DeepSeek 工具调用识别**：补充 1017 / v4 系列识别，并允许明确设置工具能力。服务商仍需返回正确的结构化工具调用；本分支不会把任意 DSML 文本直接当成可执行指令。
* **兼容网关缓存用量**：OpenAI Compatible 兼容 `prompt_tokens_details`、`input_tokens_details` 及网关返回的缓存写入字段；重复别名只计一次，不再把 `prompt_cache_miss_tokens` 当作缓存写入，并避免缓存输入与普通输入重复累计。这是统计适配，不会强制服务端产生缓存命中。任务顶部的 Cache Reads / Writes 为累计值，不能代替单次请求的原始 usage。
* **连接与令牌分组预设**：通过命令面板的 `Cline: 内网连接与 Remote 配置` 管理地址、模型、上下文及各组对应的 API Key，选择应用到 Plan、Act 或两者。分组名称是客户端备注；它不会改变服务端授权、计费倍率或令牌归属。
* **内网配置搬运与 Remote 辅助**：预设导入导出不包含 Key；显示当前扩展宿主，提供 Windows → Linux 的 SSH 配置与回环地址反向隧道片段。生成片段供检查和复制，不自动连接或修改 SSH 配置。

### New API 分组的边界

只有服务商地址和调用 Key 时，可以保存“分组 A 对应 Key A、分组 B 对应 Key B”并切换。New API 的真正分组属于服务端令牌配置，不能假设所有服务商都支持在调用 Key 后追加后缀切组。参见 [New API 令牌说明](https://docs.newapi.pro/zh/docs/guide/feature-guide/user/token)。需要直接修改服务端分组时，必须另外适配服务商提供的用户管理接口与授权；当前实现不声称支持该能力。

### 在 Windows UI 中管理 Remote API

连接 Remote SSH 后，在 Windows 的 Cline 侧栏点击插头图标，或运行命令 `Cline: 内网连接与 Remote 配置`。确认面板显示远程宿主，即可修改该远端 Cline 的 API Base URL、Key 和模型配置，不必手动寻找 Linux 上的配置文件。没有建立 Remote SSH 会话时，面板管理当前本地宿主，不会凭空连接远端。

例如分别保存 `vip` / `default` 预设和各自 Key，选中后点击“获取当前分组模型列表”。列表请求使用该组的 Key；切组或改变地址/Key 会清空旧列表，迟到的旧响应不会覆盖新组。选择模型、保存并应用即可。获取列表本身不会启动聊天或修改服务端令牌。

### Remote SSH 使用位置

在远程扩展宿主运行时，API 请求从 Linux 发出，`127.0.0.1` 也指 Linux。Windows 能访问某地址，不代表远程 Cline 能访问。连接配置面板会显示当前宿主；使用本地服务时可生成反向隧道配置，直连服务商则无需套本地网关。代理沿用当前扩展宿主的 VS Code / 系统配置，预设不会偷偷修改全局代理。

同一 Provider 的 Base URL 与 Key 在上游架构中由 Plan / Act 共享，两个模式可分别配置模型。这一限制在预设应用界面中明确提示。预设 Key 使用 VS Code SecretStorage 保存，应用后沿用 Cline 原有凭据存储机制；不把本地缓存或整个用户配置目录当作可公开分享的文件。

## 安装、构建与维护

使用本分支生成的 VSIX 离线安装到**实际运行 Cline 的本地或远程宿主**。保留当前扩展和数据备份，避免市场自动更新覆盖维护版。无需在 CentOS 7 上安装新的 Node 或编译工具链：可以在现代 Windows/Linux 构建机器上打包，再拷贝 VSIX。

详细的构建命令、测试范围、发布方式与尚未实机验证的项目见 [docs/legacy-maintenance.md](docs/legacy-maintenance.md)。本分支不自动发布到上游 Marketplace，也不自动提交到上游仓库。

---

## 上游项目介绍

<p align="center">
  <img src="assets/icons/icon.png" width="80" alt="Cline" />
</p>

<h1 align="center">Cline</h1>

<p align="center">
The open source coding agent in your IDE and terminal.
</p>

<div align="center">

<div align="center">
<table>
<tbody>
<td align="center">
<a href="https://docs.cline.bot" target="_blank"><strong>Docs</strong></a>
</td>
<td align="center">
<a href="https://discord.gg/cline" target="_blank"><strong>Discord</strong></a>
</td>
<td align="center">
<a href="https://www.reddit.com/r/cline/" target="_blank"><strong>r/cline</strong></a>
</td>
<td align="center">
<a href="https://github.com/cline/cline/discussions/categories/feature-requests?discussions_q=is%3Aopen+category%3A%22Feature+Requests%22+sort%3Atop" target="_blank"><strong>Feature Requests</strong></a>
</td>
<td align="center">
<a href="https://cline.bot/join-us" target="_blank"><strong>Join us!</strong></a>
</td>
</tbody>
</table>
</div>

</div>

<br>

<div align="center">
<table>
<tr>
<td align="center" width="50%">

### CLI

Run Cline in your terminal.
Interactive chat or fully headless
for CI/CD and scripting.

```
npm i -g cline
```

<a href="./apps/cli/README.md">Learn more</a>
<br><br>

</td>
<td align="center" width="50%">

### Kanban

Run many agents in parallel from a
web-based task board. Each card gets its own
worktree, auto-commit, and dependency chains.

```
npm i -g kanban
```

<a href="https://github.com/cline/kanban">Learn more</a>
<br><br>

</td>
</tr>
<tr>
<td align="center" width="50%">

### VS Code Extension

AI coding assistant in your editor.
Create files, run commands, browse the web,
and use tools with human-in-the-loop approval.

<a href="https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev">Install from VS Marketplace</a>
<br><br>

</td>
<td align="center" width="50%">

### JetBrains Plugin

The same Cline experience in IntelliJ IDEA,
PyCharm, WebStorm, GoLand, and the rest of
the JetBrains family.

<a href="https://plugins.jetbrains.com/plugin/28247-cline">Install from JetBrains Marketplace</a>
<br><br>

</td>
</tr>
</table>
</div>

<div align="center">
<table>
<tr>
<td align="center">

### SDK

Build your own AI agents and integrations powered by the same engine that runs the CLI, Kanban, VS Code extension, and JetBrains plugin. Custom tools, multi-agent teams, connectors, scheduled automations, and more.

```
npm install @cline/sdk
```

<a href="https://docs.cline.bot/cline-sdk/overview">Documentation</a>
<br><br>

</td>
</tr>
</table>
</div>

---

## Index

| Product | Description | Location | CHANGELOG |
|---------|------------|--------------|--------------|
| **SDK** | Node.js programmatic agent API and extension exports. | [`sdk/`](https://github.com/cline/cline/tree/main/sdk) | [CHANGELOG.md](https://github.com/cline/cline/blob/main/sdk/CHANGELOG.md) |
| **CLI** | Terminal UI, headless mode, shell commands, and CLI-specific flows. | [`apps/cli/`](https://github.com/cline/cline/tree/main/apps/cli) | [CHANGELOG.md](https://github.com/cline/cline/blob/main/apps/cli/CHANGELOG.md) |
| **VS Code Extension** | The Marketplace extension and extension host integration. | [`/`](https://github.com/cline/cline/tree/main) (WIP migrating) | [CHANGELOG.md](https://github.com/cline/cline/blob/main/CHANGELOG.md) |
| **JetBrains Plugin** | JetBrains-hosted client that talks to the shared agent core. | Currently we are not open-sourcing JetBrains plugins | - |
| **Kanban** | Web-based multi-agent task board. | [`cline/kanban`](https://github.com/cline/kanban) | [CHANGELOG.md](https://github.com/cline/kanban/blob/main/CHANGELOG.md) |
| **Docs site** | Public documentation pages. | [`docs/`](https://docs.cline.bot/) | - |

## Edits Code Across Your Project

Cline reads your project structure, understands the relationships between files, and makes coordinated changes across your codebase. It monitors linter and compiler errors as it works, fixing issues like missing imports, type mismatches, and syntax errors before you even see them. In VS Code and JetBrains, every edit shows up as a diff you can review, modify, or revert. All changes are tracked with checkpoints, so you can easily undo the agent's work.

## Runs Bash Commands

Cline executes commands directly in your terminal and watches the output in real time. Install packages, run build scripts, execute tests, deploy applications, manage databases. For long-running processes like dev servers, Cline continues working in the background and reacts to new output as it appears, catching compile errors, test failures, and server crashes as they happen.

## Plan and Act

Toggle between Plan mode and Act mode. In Plan mode, Cline explores your codebase, asks clarifying questions, and lays out a strategy. Once you're aligned, switch to Act mode and Cline executes the plan. Every file edit and terminal command requires your approval, so you stay in control of what actually changes. Or toggle auto-approve and let Cline run autonomously.

## Rules and Skills

Define project-specific rules in `.clinerules` files that guide how Cline works in your codebase: coding standards, architecture conventions, deployment procedures, testing requirements. Rules are picked up automatically by the CLI, VS Code extension, and JetBrains plugin. Use skills to let the model load specific rules when needed. 

## Works With Every Model

Cline is not locked to a single AI provider. Use whichever model fits your workflow:

| Provider | Models |
|----------|--------|
| Anthropic | Claude Opus, Sonnet, Haiku |
| OpenAI | GPT series model |
| Google | Gemini series model |
| OpenRouter | 200+ models from any provider |
| Vercel AI Gateway | Models through Vercel AI Gateway |
| AWS Bedrock | Claude, Llama, and more |
| Azure / GCP Vertex | All hosted models |
| Cerebras / Groq | Fast inference models |
| Ollama / LM Studio | Run local models on your machine |
| Any OpenAI-compatible API | Self-hosted or third-party endpoints |

## Extend With Plugins or MCP Servers

Extend Cline's capabilities with plugins. Using the SDK, register tools and lifecycle hooks programmatically through the plugin system for logging, auditing, policy enforcement, or adding domain-specific capabilities. Simple plugin example below.

```typescript
import { Agent, createTool } from "@cline/sdk"

const deployTool = createTool({
  name: "deploy",
  description: "Deploy the current branch to staging.",
  inputSchema: { type: "object", properties: { env: { type: "string" } }, required: ["env"] },
  execute: async (input) => {
    // your deployment logic
  },
})

const agent = new Agent({ tools: [deployTool], /* ... */ })
```
...or use [MCP servers](https://github.com/modelcontextprotocol) to connect to databases, query APIs, manage cloud infrastructure, and interact with external systems. Use [community-built servers](https://github.com/modelcontextprotocol/servers) or ask Cline to create custom tools on the fly. In the CLI, manage servers with `cline mcp`.

## Multi-Agent Teams

Coordinate multiple agents working together on complex tasks. A coordinator agent breaks the work into subtasks and delegates to specialist agents, each with their own tools and context. Team state persists across sessions so you can pick up where you left off.

```bash
cline --team-name auth-sprint "Plan and implement user authentication with tests"
```

## Scheduled Agents

Run agents on cron schedules for recurring automations. Daily PR summaries, weekly dependency checks, codebase health reports. Schedules persist across restarts and run independently of any terminal session.

```bash
cline schedule create "PR summary" \
  --cron "0 9 * * MON-FRI" \
  --prompt "List all open PRs and their review status" \
  --workspace /path/to/repo
```

## Connect to Slack, Telegram, Discord, and More

Chat with your agent from any messaging platform: Telegram, Slack, Discord, Google Chat, WhatsApp, and Linear. Each conversation thread maps to an agent session with full context. Set up access control to restrict who can interact with your agent.

```bash
# Connect to Telegram
cline connect telegram -k $BOT_TOKEN
# Connect to Slack through webhook
cline connect slack --bot-token $SLACK_TOKEN --signing-secret $SECRET --base-url $URL
# Connect to Slack using socket mode
cline connect slack --bot-token $SLACK_TOKEN --app-token $SLACK_APP_TOKEN
```

## Headless CLI for CI/CD

Run Cline with zero interaction for scripting and automation. Pipe input, get JSON output, chain commands, integrate into CI/CD pipelines.

```bash
cline "Run tests and fix any failures"
git diff origin/main | cline  "Review these changes for issues"
cline --json "List all TODO comments" | jq -r 'select(.type == "agent_event" and .event.text) | .event.text'
```

## Contributing

Start with the [Contributing Guide](CONTRIBUTING.md). Join our [Discord](https://discord.gg/cline) and head to the `#contributors` channel to connect with other contributors. Check our [careers page](https://cline.bot/join-us) for full-time roles.

## License

[Apache 2.0 © 2026 Cline Bot Inc.](./LICENSE)
