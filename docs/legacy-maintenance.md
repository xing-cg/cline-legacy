# 固定版本维护说明

## 基线与制品

* 上游仓库：<https://github.com/cline/cline>
* 基线 tag：`v4.0.12`
* 基线提交：`f267bf47e394e2c38f8b321c973a8d5867a14cd5`
* 维护分支：`legacy/4.0.12-intranet`
* 扩展版本：`4.0.12`；最低 VS Code 声明沿用 `^1.84.0`。
* 首要目标环境：Windows VS Code 1.95.3 + Remote SSH + CentOS 7 / glibc 2.17。

VSIX 保留上游扩展标识，安装时会替换同一标识的 Cline。维护批次通过文件名、源码提交与 SHA-256 区分，不通过伪装新版或降低新版 engines 要求来安装。

## 在现代构建机器上构建

使用 Node.js 22（建议 22.12 或更新的 22.x）和 npm；在仓库根目录执行：

```sh
npm --prefix apps/vscode ci
npm --prefix apps/vscode/webview-ui ci
cd apps/vscode
npm run check-types
npm run build:webview
node esbuild.mjs --production
node scripts/package-legacy.mjs
```

首次构建需要联网下载锁定依赖与 protoc；Node.js 构建版本不是 CentOS 7 上需要另行安装的运行时版本。若本地 npm 策略禁用了安装脚本，需要允许官方 `grpc-tools` 和 `esbuild` 安装步骤后生成 protobuf。

本分支的 GitHub Actions 工作流 `legacy-maintenance` 使用锁文件安装、检查类型、运行维护功能测试、构建并生成可下载制品。它不需要模型服务 Key，不自动发布到 Marketplace。工作流通过后仍需验证实际使用的服务商和 CentOS 7 宿主。

## 安装与回退

1. 备份原 4.0.12 VSIX 与当前 Cline 数据。不要把包含凭据的完整用户目录上传到仓库。
2. 在 VS Code 扩展页确认 Cline 运行于本机还是 SSH 目标，向对应宿主安装维护版 VSIX。
3. 重新加载窗口，确认版本仍为 4.0.12；命令面板应出现 `Cline: 内网连接与 Remote 配置`。
4. 填写一个连接预设，核对协议、地址和模型；先获取模型列表，再用只读目录工具验证聊天和工具调用。
5. 如需回退，重新安装原版 VSIX 并重新加载窗口。上下文已经被压缩的旧会话不会因为替换程序自动还原。

## 维护功能验证范围

自动化检查覆盖模型请求的 URL / 鉴权 / 错误处理、自定义模型与配置转换、上下文阈值、工具能力、预设导入导出和 SSH 片段验证。测试不使用用户 API Key。

以下必须分别在目标环境确认，不能仅凭打包成功标成通过：

| 项目 | 验证方法 |
| --- | --- |
| CentOS 7 扩展激活 | 在实际 Remote SSH 宿主加载维护版，检查扩展宿主日志。 |
| 服务商协议 | 分别验证 `/v1/models`、聊天流式输出、正确的工具参数与工具结果回传。 |
| 1M 上下文 | 服务商确认支持并通过实际请求；客户端的 1M 配置不会改变服务端限制。 |
| 工具执行 | 先测试只读列目录、读取文件，再测试终端和编辑。 |
| 本地二进制 | 分别测试搜索、检查点、浏览器及所用 MCP；这些依赖可能有独立 glibc / Node 要求。 |
| SSH 反向隧道 | 核对服务器允许转发、端口未占用；仅绑定 `127.0.0.1`。 |

## 功能边界

* 预设分组是服务商已经授权的 Key 的本地映射，不是 New API 管理端分组编辑。
* Remote 面板生成配置片段，不管理 SSH 密码、不自动安装服务、不自动打开防火墙。
* 没有批量清除用户会话、修改组织管控策略或关闭 TLS 校验的功能。
* `Cline hit repeated tool call failures` 是通用汇总提示。客户端模型识别修复不能证明服务商协议或终端命令错误已全部解决；应检查前面的具体错误。

## 后续回移原则

保持 VS Code 版本门槛与运行目标稳定，按独立问题回移源码修复。不要直接跟随上游主分支更新整套依赖。新增原生依赖、新版 VS Code API 或 Node API 前，应先检查目标宿主。每批修改记录源码提交、测试结果和制品校验值。
