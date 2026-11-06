import { randomBytes } from "node:crypto"
import { buildApiHandler } from "@core/api"
import type { Controller } from "@core/controller"
import * as vscode from "vscode"
import { ExtensionRegistryInfo } from "@/registry"
import { discoverModels } from "@/services/models/discovery"
import { connectionPanelHtml } from "./connection-panel-html"
import {
	assertUnlocked,
	ConnectionProfileStore,
	generateSshConfig,
	ProfileError,
	type ProfileTarget,
	profileUpdates,
} from "./connection-profiles"

export function registerConnectionPanel(
	context: vscode.ExtensionContext,
	controller: Controller,
	store: ConnectionProfileStore,
): void {
	let panel: vscode.WebviewPanel | undefined
	context.subscriptions.push(
		vscode.commands.registerCommand(ExtensionRegistryInfo.commands.LegacyConnections, () => {
			if (panel) return panel.reveal()
			const current = vscode.window.createWebviewPanel(
				"cline.legacyConnections",
				"Cline · 内网连接与 Remote 配置",
				vscode.ViewColumn.One,
				{
					enableScripts: true,
					localResourceRoots: [],
					retainContextWhenHidden: true,
				},
			)
			panel = current
			current.webview.html = connectionPanelHtml(randomBytes(24).toString("hex"))
			let lastSsh = ""
			let queue: Promise<void> = Promise.resolve()
			const state = async (notice = "", selectedId?: string) => {
				await current.webview.postMessage({
					type: "state",
					profiles: await store.publicList(),
					selectedId,
					notice,
					environment: `窗口：${vscode.env.remoteName || "本地"} · 扩展进程：${process.platform} / Node ${process.versions.node} · VS Code ${vscode.version} · Cline ${ExtensionRegistryInfo.version}`,
				})
			}
			const result = async (message: string, error = false, ssh?: string) => {
				await current.webview.postMessage({
					type: "result",
					message,
					error,
					ssh,
				})
			}
			const listener = current.webview.onDidReceiveMessage((message: unknown) => {
				queue = queue.then(async () => {
					try {
						if (!message || typeof message !== "object") throw new ProfileError("无效操作。")
						const request = message as Record<string, unknown>
						switch (request.action) {
							case "discoverModels": {
								if (!Number.isSafeInteger(request.requestId)) throw new ProfileError("模型列表请求编号无效。")
								try {
									const draft = await store.discoveryRequest(request.draft)
									const models = await discoverModels(draft)
									await current.webview.postMessage({ type: "models", requestId: request.requestId, models })
								} catch (error) {
									// discoverModels emits only locally sanitized errors, never provider bodies or headers.
									const safeMessage =
										error instanceof ProfileError
											? error.message
											: error instanceof Error && error.message.startsWith("Model discovery: ")
												? error.message
												: "获取模型列表失败，请检查当前扩展宿主的网络或凭据存储。"
									await current.webview.postMessage({
										type: "models",
										requestId: request.requestId,
										error: safeMessage,
									})
								}
								break
							}
							case "ready":
								await state()
								break
							case "save": {
								const saved = await store.save(request.profile, request.apiKey)
								await state(saved.cleanupWarning || "连接已保存。", saved.id)
								break
							}
							case "delete": {
								const id = String(request.id)
								const name = store.list().find((item) => item.id === id)?.name
								if (!name) throw new ProfileError("连接配置不存在。")
								const answer = await vscode.window.showWarningMessage(
									`删除连接“${name}”及其保存的 Key？`,
									{ modal: true },
									"删除",
								)
								if (answer === "删除") {
									const cleaned = await store.remove(id)
									await state(
										cleaned ? "连接已删除。" : "连接已删除，但凭据清理失败；凭据已解除绑定，不会恢复连接。",
									)
								} else await result("已取消删除。")
								break
							}
							case "apply": {
								let task = controller.task
								if (
									task &&
									(task.taskState.isStreaming ||
										task.taskState.isWaitingForFirstChunk ||
										task.taskState.currentlySummarizing)
								) {
									throw new ProfileError("任务正在请求或压缩，请停止任务或等待完成后再切换连接。")
								}
								const { profile, key } = await store.getWithKey(String(request.id))
								const updates = profileUpdates(profile, key, request.target as ProfileTarget)
								const managed = controller.stateManager.getRemoteConfigSettings()
								assertUnlocked(updates, managed)
								if (request.target !== "both" && managed.planActSeparateModelsSetting === false) {
									throw new ProfileError("组织配置禁止分离 Plan / Act 模型，请选择同时应用。")
								}
								task = controller.task
								if (
									task &&
									(task.taskState.isStreaming ||
										task.taskState.isWaitingForFirstChunk ||
										task.taskState.currentlySummarizing)
								) {
									throw new ProfileError("任务正在请求或压缩，请停止任务或等待完成后再切换连接。")
								}
								const updated = {
									...controller.stateManager.getApiConfiguration(),
									...updates,
								}
								if (request.target !== "both")
									controller.stateManager.setGlobalState("planActSeparateModelsSetting", true)
								controller.stateManager.setApiConfiguration(updated)
								if (task)
									task.api = buildApiHandler(
										{ ...updated, ulid: task.ulid },
										controller.stateManager.getGlobalSettingsKey("mode"),
									)
								await controller.postStateToWebview()
								await result(`已应用连接“${profile.name}”。地址和 Key 为该 Provider 的共享配置。`)
								break
							}
							case "export": {
								const uri = await vscode.window.showSaveDialog({
									saveLabel: "导出（不含 Key）",
									filters: { JSON: ["json"] },
								})
								if (uri) await vscode.workspace.fs.writeFile(uri, Buffer.from(store.export(), "utf8"))
								await result(uri ? "配置已导出，不包含 API Key 或请求头。" : "已取消导出。")
								break
							}
							case "import": {
								const uris = await vscode.window.showOpenDialog({
									canSelectMany: false,
									openLabel: "导入连接配置",
									filters: { JSON: ["json"] },
								})
								if (!uris?.[0]) {
									await result("已取消导入。")
									break
								}
								const stat = await vscode.workspace.fs.stat(uris[0])
								if (stat.size > 1024 * 1024) throw new ProfileError("导入文件不能超过 1 MB。")
								const data = await vscode.workspace.fs.readFile(uris[0])
								const count = await store.import(Buffer.from(data).toString("utf8"))
								await state(`已导入 ${count} 个新配置，请逐个填写对应 Key。`)
								break
							}
							case "ssh":
								lastSsh = generateSshConfig(request.ssh)
								await result("已生成 SSH 配置，请在 Windows 侧使用。", false, lastSsh)
								break
							case "copySsh":
								if (!lastSsh) throw new ProfileError("请先生成 SSH 配置。")
								await vscode.env.clipboard.writeText(lastSsh)
								await result("SSH 配置已复制。")
								break
							case "settings":
								await vscode.commands.executeCommand(ExtensionRegistryInfo.commands.SettingsButton)
								await result("已打开 Cline 设置。")
								break
							default:
								throw new ProfileError("不支持的操作。")
						}
					} catch (error) {
						// Never echo raw SDK, file, storage, or credential errors to the webview/log.
						await result(
							error instanceof ProfileError
								? error.message
								: "操作未完成，请检查文件权限或 Secret Storage 是否可用后重试。",
							true,
						)
					}
				})
			})
			current.onDidDispose(
				() => {
					listener.dispose()
					panel = undefined
				},
				null,
				context.subscriptions,
			)
			context.subscriptions.push(current)
		}),
	)
}
