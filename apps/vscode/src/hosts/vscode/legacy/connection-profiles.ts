import { randomUUID } from "node:crypto"
import type { ApiConfiguration, ModelInfo, OpenAiCompatibleModelInfo } from "@shared/api"
import type { ModelDiscoveryRequest } from "@/services/models/discovery"

export interface ConnectionProfile {
	id: string
	name: string
	tokenGroup: string
	provider: "openai" | "anthropic"
	baseUrl: string
	modelId: string
	contextWindow: number
	maxTokens: number
	supportsTools: boolean
	supportsImages: boolean
	supportsPromptCache: boolean
}

export class ProfileError extends Error {}

function textField(value: unknown, label: string, max = 200, allowEmpty = false): string {
	if (
		typeof value !== "string" ||
		Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
	) {
		throw new ProfileError(`${label}必须是单行文字。`)
	}
	const result = value.trim()
	if ((!allowEmpty && !result) || result.length > max) throw new ProfileError(`${label}为空或过长。`)
	return result
}

function positiveInteger(value: unknown, label: string, max: number): number {
	const number = typeof value === "number" ? value : Number(value)
	if (!Number.isSafeInteger(number) || number < 1 || number > max) throw new ProfileError(`${label}超出有效范围。`)
	return number
}

function profileEndpoint(value: unknown): string {
	const baseUrl = textField(value, "Base URL", 2048)
	let url: URL
	try {
		url = new URL(baseUrl)
	} catch {
		throw new ProfileError("Base URL 必须是完整的 HTTP 或 HTTPS 地址。")
	}
	if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
		throw new ProfileError("Base URL 只支持 HTTP/HTTPS，且不能包含用户名、密码、查询参数或片段。")
	}
	return url.toString().replace(/\/+$/, "")
}

export function validateProfile(value: unknown, id: string = randomUUID()): ConnectionProfile {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new ProfileError("连接配置格式不正确。")
	const input = value as Record<string, unknown>
	if (input.provider !== "openai" && input.provider !== "anthropic") throw new ProfileError("请选择支持的 API 协议。")
	const baseUrl = profileEndpoint(input.baseUrl)
	const contextWindow = positiveInteger(input.contextWindow, "上下文窗口", 10_000_000)
	const maxTokens = positiveInteger(input.maxTokens, "最大输出", contextWindow)
	for (const flag of ["supportsTools", "supportsImages", "supportsPromptCache"]) {
		if (typeof input[flag] !== "boolean") throw new ProfileError("模型能力必须明确选择。")
	}
	return {
		id,
		name: textField(input.name, "连接名称", 100),
		tokenGroup: textField(input.tokenGroup ?? "", "令牌分组备注", 100, true),
		provider: input.provider,
		baseUrl,
		modelId: textField(input.modelId, "模型 ID"),
		contextWindow,
		maxTokens,
		supportsTools: input.supportsTools as boolean,
		supportsImages: input.supportsImages as boolean,
		supportsPromptCache: input.supportsPromptCache as boolean,
	}
}

interface ProfileStorage {
	get(): unknown
	update(profiles: ConnectionProfile[]): PromiseLike<void>
	getSecret(id: string): PromiseLike<string | undefined>
	storeSecret(id: string, secret: string): PromiseLike<void>
	deleteSecret(id: string): PromiseLike<void>
}

/** Profile metadata is allowlisted; credentials never enter metadata or exports. */
export class ConnectionProfileStore {
	constructor(private readonly storage: ProfileStorage) {}

	list(): ConnectionProfile[] {
		const stored = this.storage.get()
		if (!Array.isArray(stored)) return []
		return stored.map((profile) => validateProfile(profile, String(profile.id)))
	}

	async publicList(): Promise<Array<ConnectionProfile & { hasKey: boolean }>> {
		return Promise.all(
			this.list().map(async (profile) => ({
				...profile,
				hasKey: Boolean(await this.storage.getSecret(profile.id)),
			})),
		)
	}

	async save(input: unknown, apiKey: unknown): Promise<ConnectionProfile & { cleanupWarning?: string }> {
		const profiles = this.list()
		const requestedId = (input as Record<string, unknown> | null)?.id
		const previous = profiles.find((profile) => profile.id === requestedId)
		if (requestedId && !previous) throw new ProfileError("连接配置不存在，请重新选择。")
		const profile = validateProfile(input, previous?.id)
		const key = textField(apiKey ?? "", "API Key", 8192, true)
		if (previous && (previous.baseUrl !== profile.baseUrl || previous.provider !== profile.provider) && !key) {
			throw new ProfileError("地址或协议已改变，请重新输入对应的 API Key。")
		}
		if (!previous && profiles.length >= 100) throw new ProfileError("最多保存 100 个连接配置。")
		// Never replace a referenced key before its new endpoint has been committed.
		// Rotating identities makes a failed metadata write leave the old binding intact.
		if (key) {
			profile.id = randomUUID()
			await this.storage.storeSecret(profile.id, key)
		}
		if (previous) profiles[profiles.indexOf(previous)] = profile
		else {
			profiles.push(profile)
		}
		try {
			await this.storage.update(profiles)
		} catch (error) {
			if (key) {
				try {
					await this.storage.deleteSecret(profile.id)
				} catch {
					/* Unreferenced key; never apply it to another endpoint. */
				}
			}
			throw error
		}
		if (previous && previous.id !== profile.id) {
			try {
				await this.storage.deleteSecret(previous.id)
			} catch {
				return { ...profile, cleanupWarning: "新连接已保存，旧凭据清理失败；旧凭据已解除绑定，不会用于连接请求。" }
			}
		}
		return profile
	}

	async remove(id: string): Promise<boolean> {
		const profiles = this.list()
		if (!profiles.some((profile) => profile.id === id)) throw new ProfileError("连接配置不存在。")
		await this.storage.update(profiles.filter((profile) => profile.id !== id))
		try {
			await this.storage.deleteSecret(id)
			return true
		} catch {
			// Metadata stays deleted even if the credential backend cannot clean up.
			return false
		}
	}

	async getWithKey(id: string): Promise<{ profile: ConnectionProfile; key: string }> {
		const profile = this.list().find((item) => item.id === id)
		if (!profile) throw new ProfileError("连接配置不存在。")
		const key = await this.storage.getSecret(profile.id)
		if (!key) throw new ProfileError("该配置尚未保存 API Key，请填写后保存。")
		return { profile, key }
	}

	/** Resolve only the requested endpoint/key pair; a draft does not need a model yet. */
	async discoveryRequest(value: unknown): Promise<ModelDiscoveryRequest> {
		if (!value || typeof value !== "object" || Array.isArray(value)) throw new ProfileError("模型列表请求格式不正确。")
		const draft = value as Record<string, unknown>
		if (draft.provider !== "openai" && draft.provider !== "anthropic") throw new ProfileError("请选择支持的 API 协议。")
		const baseUrl = profileEndpoint(draft.baseUrl)
		const enteredKey = textField(draft.apiKey ?? "", "API Key", 8192, true)
		if (enteredKey) return { baseUrl, protocol: draft.provider, apiKey: enteredKey }
		if (typeof draft.id !== "string" || !draft.id) throw new ProfileError("请填写当前分组的 API Key 后再获取模型列表。")
		const { profile, key } = await this.getWithKey(draft.id)
		if (profile.baseUrl !== baseUrl || profile.provider !== draft.provider) {
			throw new ProfileError("地址或协议已改变，请重新输入对应的 API Key 后再获取模型列表。")
		}
		return { baseUrl, protocol: profile.provider, apiKey: key }
	}

	export(): string {
		return JSON.stringify({ format: "cline-legacy-connections", version: 1, profiles: this.list() }, null, 2)
	}

	async import(json: string): Promise<number> {
		let parsed: { format?: string; version?: number; profiles?: unknown[] }
		try {
			parsed = JSON.parse(json)
		} catch {
			throw new ProfileError("导入文件不是有效 JSON。")
		}
		if (!parsed || parsed.format !== "cline-legacy-connections" || parsed.version !== 1 || !Array.isArray(parsed.profiles)) {
			throw new ProfileError("请选择本功能导出的连接配置文件。")
		}
		const current = this.list()
		if (current.length + parsed.profiles.length > 100) throw new ProfileError("导入后不能超过 100 个连接配置。")
		// Assign fresh identities and never read keys/headers from imported data.
		const imported = parsed.profiles.map((value) => validateProfile(value))
		await this.storage.update([...current, ...imported])
		return imported.length
	}
}

export type ProfileTarget = "plan" | "act" | "both"

export function profileUpdates(profile: ConnectionProfile, key: string, target: ProfileTarget): Partial<ApiConfiguration> {
	if (!["plan", "act", "both"].includes(target)) throw new ProfileError("应用目标必须为 Plan、Act 或两者。")
	const info: ModelInfo = {
		contextWindow: profile.contextWindow,
		maxTokens: profile.maxTokens,
		supportsTools: profile.supportsTools,
		supportsImages: profile.supportsImages,
		supportsPromptCache: profile.supportsPromptCache,
	}
	const updates: Partial<ApiConfiguration> =
		profile.provider === "openai"
			? {
					openAiBaseUrl: profile.baseUrl,
					openAiApiKey: key,
					openAiHeaders: {},
					azureApiVersion: "",
					azureIdentity: false,
				}
			: { anthropicBaseUrl: profile.baseUrl, apiKey: key }
	for (const mode of target === "both" ? (["plan", "act"] as const) : [target]) {
		if (mode === "plan") {
			updates.planModeApiProvider = profile.provider
			if (profile.provider === "openai") {
				updates.planModeOpenAiModelId = profile.modelId
				updates.planModeOpenAiModelInfo = {
					...info,
					supportsStreaming: true,
				} as OpenAiCompatibleModelInfo
			} else {
				updates.planModeApiModelId = profile.modelId
				updates.planModeAnthropicModelInfo = info
			}
		} else {
			updates.actModeApiProvider = profile.provider
			if (profile.provider === "openai") {
				updates.actModeOpenAiModelId = profile.modelId
				updates.actModeOpenAiModelInfo = {
					...info,
					supportsStreaming: true,
				} as OpenAiCompatibleModelInfo
			} else {
				updates.actModeApiModelId = profile.modelId
				updates.actModeAnthropicModelInfo = info
			}
		}
	}
	return updates
}

export function assertUnlocked(updates: Partial<ApiConfiguration>, remoteConfig: object): void {
	const remote = remoteConfig as Record<string, unknown>
	const configured = remote.configuredApiKeys as Record<string, boolean> | undefined
	const provider = updates.planModeApiProvider ?? updates.actModeApiProvider
	if (Object.keys(updates).some((key) => remote[key] !== undefined) || (provider && configured?.[provider])) {
		throw new ProfileError("对应连接由组织远程配置管理，不能通过本地预设覆盖。")
	}
}

export function generateSshConfig(value: unknown): string {
	if (!value || typeof value !== "object") throw new ProfileError("SSH 配置格式不正确。")
	const input = value as Record<string, unknown>
	const host = textField(input.host, "Linux 主机", 253)
	const user = textField(input.user, "SSH 用户", 64)
	if (!/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(host) || !/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(user)) {
		throw new ProfileError("主机请填写域名或 IPv4；用户名不能包含空格或命令字符。")
	}
	const port = positiveInteger(input.sshPort, "SSH 端口", 65535)
	const local = positiveInteger(input.localServicePort, "Windows 服务端口", 65535)
	const remote = positiveInteger(input.remoteListenPort, "Linux 监听端口", 65535)
	return `# 在 Windows 的 SSH config 中添加；由 Windows 主动连接 Linux\nHost cline-legacy-remote\n    HostName ${host}\n    User ${user}\n    Port ${port}\n    RemoteForward 127.0.0.1:${remote} 127.0.0.1:${local}\n    ExitOnForwardFailure yes\n    ServerAliveInterval 30\n\n# 或在 Windows 终端单独保持隧道：\nssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -R 127.0.0.1:${remote}:127.0.0.1:${local} -p ${port} ${user}@${host}\n\n# Linux 上的扩展连接 http://127.0.0.1:${remote}；协议路径按服务填写。\n`
}
