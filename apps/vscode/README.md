# Cline 4.0.12 内网维护版

面向固定 VS Code 1.95.3、Remote SSH、CentOS 7 / glibc 2.17 及离线安装环境的社区维护分支。保留 4.0.12 基线与许可证，不是 Cline 官方发行版。

增加按需获取模型列表、Anthropic 自定义模型、连接与令牌分组预设以及 SSH 配置生成；修复 DeepSeek 上下文被强制限制为 128k 和部分工具能力识别问题。

命令面板入口：**Cline: 内网连接与 Remote 配置**。令牌分组是各组 API Key 的本地映射，不修改 New API 服务端的计费或权限。SSH 功能仅生成供检查的配置片段。

4.0.12 的 VS Code 声明为 `^1.84.0`；上游 4.1.0 升为 `^1.101.0`。VS Code Server 的 glibc 要求是另一层限制，不能仅凭扩展清单保证所有 CentOS 7 功能可用。完整原因、使用方法及验证记录见此维护分支仓库根目录的 README 与 `docs/legacy-maintenance.md`。
