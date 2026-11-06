import { strict as assert } from "node:assert"
import { connectionPanelHtml } from "../connection-panel-html"
import {
	assertUnlocked,
	ConnectionProfileStore,
	generateSshConfig,
	profileUpdates,
	validateProfile,
} from "../connection-profiles"

const example = {
	name: "开发连接",
	tokenGroup: "标准组",
	provider: "openai",
	baseUrl: "https://api.example/v1/",
	modelId: "custom-model",
	contextWindow: 1_000_000,
	maxTokens: 8192,
	supportsTools: true,
	supportsImages: false,
	supportsPromptCache: false,
}

function setup() {
	let metadata: unknown = []
	const failures = { update: false, deleteSecret: false }
	const secrets = new Map<string, string>()
	const store = new ConnectionProfileStore({
		get: () => metadata,
		update: async (value) => {
			if (failures.update) throw new Error("simulated storage failure")
			metadata = value
		},
		getSecret: async (id) => secrets.get(id),
		storeSecret: async (id, value) => {
			secrets.set(id, value)
		},
		deleteSecret: async (id) => {
			if (failures.deleteSecret) throw new Error("simulated secret deletion failure")
			secrets.delete(id)
		},
	})
	return { store, secrets, failures, metadata: () => metadata }
}

describe("legacy connection profiles", () => {
	it("discovers separate token groups with their own keys and accepts an unsaved draft", async () => {
		const { store } = setup()
		const standard = await store.save({ ...example, tokenGroup: "default" }, "default-key")
		const vip = await store.save({ ...example, tokenGroup: "vip" }, "vip-key")
		const modelLists: Record<string, string[]> = { "default-key": ["basic-model"], "vip-key": ["premium-model"] }
		const listFor = async (id: string) => {
			const request = await store.discoveryRequest({ id, baseUrl: example.baseUrl, provider: "openai", apiKey: "" })
			return modelLists[request.apiKey!]
		}
		assert.deepEqual(await listFor(standard.id), ["basic-model"])
		assert.deepEqual(await listFor(vip.id), ["premium-model"])
		const draft = await store.discoveryRequest({
			baseUrl: "https://draft.example",
			provider: "anthropic",
			apiKey: "draft-key",
		})
		assert.deepEqual(draft, { baseUrl: "https://draft.example", protocol: "anthropic", apiKey: "draft-key" })
		assert.equal(store.list().length, 2)
	})

	it("never sends a stored key to a changed draft endpoint or protocol", async () => {
		const { store } = setup()
		const saved = await store.save(example, "stored-key")
		await assert.rejects(store.discoveryRequest({ baseUrl: example.baseUrl, provider: "openai", apiKey: "" }))
		await assert.rejects(store.discoveryRequest({ id: saved.id, baseUrl: "https://other.example/v1", provider: "openai" }))
		await assert.rejects(store.discoveryRequest({ id: saved.id, baseUrl: example.baseUrl, provider: "anthropic" }))
		await assert.rejects(store.discoveryRequest({ id: "unknown", baseUrl: example.baseUrl, provider: "openai" }))
		await assert.rejects(
			store.discoveryRequest({ id: saved.id, baseUrl: "file:///tmp/api", provider: "openai", apiKey: "new-key" }),
		)
		const explicit = await store.discoveryRequest({
			id: saved.id,
			baseUrl: "https://other.example/v1",
			provider: "openai",
			apiKey: "new-key",
		})
		assert.equal(explicit.apiKey, "new-key")
		assert.equal((await store.getWithKey(saved.id)).key, "stored-key")
	})

	it("validates endpoints, capacities and explicitly declared capabilities", () => {
		assert.equal(validateProfile(example).baseUrl, "https://api.example/v1")
		for (const baseUrl of [
			"file:///etc/passwd",
			"https://key@api.example/v1",
			"https://api.example/?api_key=secret",
			"https://api.example/#secret",
		]) {
			assert.throws(() => validateProfile({ ...example, baseUrl }))
		}
		assert.throws(() => validateProfile({ ...example, contextWindow: 1.5 }))
		assert.throws(() => validateProfile({ ...example, maxTokens: 1_000_001 }))
		assert.throws(() => validateProfile({ ...example, supportsTools: "true" }))
		assert.throws(() => validateProfile({ ...example, modelId: "model\nsecond-line" }))
	})

	it("keeps credentials out of metadata, public results, and exports", async () => {
		const { store, secrets, metadata } = setup()
		const saved = await store.save(
			{
				...example,
				headers: { Authorization: "secret-header" },
				apiKey: "ignored-input",
			},
			"sk-private-key",
		)
		assert.equal(secrets.get(saved.id), "sk-private-key")
		assert.equal((await store.publicList())[0].hasKey, true)
		for (const output of [JSON.stringify(metadata()), JSON.stringify(await store.publicList()), store.export()]) {
			assert.ok(!output.includes("sk-private-key"))
			assert.ok(!output.includes("secret-header"))
			assert.ok(!output.includes("ignored-input"))
		}
		assert.equal((await store.getWithKey(saved.id)).key, "sk-private-key")
	})

	it("retains a saved key only for the same provider and address", async () => {
		const { store } = setup()
		const saved = await store.save(example, "sk-first")
		await store.save({ ...saved, name: "改名" }, "")
		assert.equal((await store.getWithKey(saved.id)).key, "sk-first")
		await assert.rejects(store.save({ ...saved, baseUrl: "https://other.example/v1" }, ""))
		await assert.rejects(store.save({ ...saved, provider: "anthropic" }, ""))
		const rotated = await store.save({ ...saved, baseUrl: "https://other.example/v1" }, "sk-second")
		assert.notEqual(rotated.id, saved.id)
		assert.equal((await store.getWithKey(rotated.id)).key, "sk-second")
		await assert.rejects(store.getWithKey(saved.id))
	})

	it("preserves the old endpoint/key binding when metadata persistence fails", async () => {
		const { store, secrets, failures } = setup()
		const original = await store.save(example, "old-service-key")
		failures.update = true
		await assert.rejects(store.save({ ...original, baseUrl: "https://new.example/v1" }, "new-service-key"))
		const restored = await store.getWithKey(original.id)
		assert.equal(restored.profile.baseUrl, "https://api.example/v1")
		assert.equal(restored.key, "old-service-key")
		assert.deepEqual([...secrets.values()], ["old-service-key"])
	})

	it("never rebinds an orphan key when credential cleanup fails", async () => {
		const { store, failures } = setup()
		const original = await store.save(example, "old-service-key")
		failures.deleteSecret = true
		const replacement = await store.save({ ...original, baseUrl: "https://new.example/v1" }, "new-service-key")
		assert.ok(replacement.cleanupWarning)
		await assert.rejects(store.getWithKey(original.id))
		assert.equal((await store.getWithKey(replacement.id)).key, "new-service-key")
		assert.equal(await store.remove(replacement.id), false)
		assert.deepEqual(store.list(), [])
		await assert.rejects(store.getWithKey(replacement.id))
	})

	it("imports fresh identities without keys and deletes only the selected key", async () => {
		const { store, secrets } = setup()
		const saved = await store.save(example, "sk-first")
		const exported = JSON.parse(store.export())
		exported.profiles[0].apiKey = "must-ignore"
		exported.profiles[0].headers = { Authorization: "must-ignore" }
		assert.equal(await store.import(JSON.stringify(exported)), 1)
		const all = await store.publicList()
		assert.equal(all.length, 2)
		assert.notEqual(all[0].id, all[1].id)
		assert.equal(all[1].hasKey, false)
		await assert.rejects(store.getWithKey(all[1].id))
		await store.remove(saved.id)
		assert.equal(secrets.size, 0)
		assert.equal(store.list().length, 1)
		await assert.rejects(store.import('{"format":"not-supported","profiles":[]}'))
	})

	it("applies mode-specific model settings and resets previous OpenAI credentials in headers", () => {
		const profile = validateProfile(example)
		const plan = profileUpdates(profile, "key", "plan")
		assert.equal(plan.planModeApiProvider, "openai")
		assert.equal(plan.planModeOpenAiModelInfo?.contextWindow, 1_000_000)
		assert.equal(plan.actModeApiProvider, undefined)
		assert.equal(plan.openAiApiKey, "key")
		assert.deepEqual(plan.openAiHeaders, {})
		assert.equal(plan.azureIdentity, false)
		assert.equal(plan.azureApiVersion, "")
		const both = profileUpdates(validateProfile({ ...example, provider: "anthropic" }), "key", "both")
		assert.equal(both.planModeApiModelId, "custom-model")
		assert.equal(both.actModeApiModelId, "custom-model")
		assert.equal(both.actModeAnthropicModelInfo?.supportsTools, true)
		assert.throws(() => profileUpdates(profile, "key", "invalid" as "plan"))
	})

	it("does not bypass managed endpoints, models or provider keys", () => {
		const updates = profileUpdates(validateProfile(example), "key", "both")
		assert.throws(() => assertUnlocked(updates, { openAiBaseUrl: "https://managed.example/v1" }))
		assert.throws(() => assertUnlocked(updates, { actModeOpenAiModelId: "managed-model" }))
		assert.throws(() => assertUnlocked(updates, { configuredApiKeys: { openai: true } }))
		assert.doesNotThrow(() => assertUnlocked(updates, { configuredApiKeys: {} }))
		assert.doesNotThrow(() => assertUnlocked(updates, { configuredApiKeys: { bedrock: true } }))
	})

	it("generates loopback-bound SSH snippets and rejects shell/config injection", () => {
		const input = {
			host: "192.168.1.20",
			user: "developer",
			sshPort: 22,
			localServicePort: 8000,
			remoteListenPort: 18000,
		}
		const result = generateSshConfig(input)
		assert.ok(result.includes("RemoteForward 127.0.0.1:18000 127.0.0.1:8000"))
		assert.ok(result.includes("-R 127.0.0.1:18000:127.0.0.1:8000"))
		for (const host of ["-oProxyCommand=whoami", "server;whoami", "server\nProxyCommand whoami", "$(whoami)"]) {
			assert.throws(() => generateSshConfig({ ...input, host }))
		}
		assert.throws(() => generateSshConfig({ ...input, user: "user@other" }))
		assert.throws(() => generateSshConfig({ ...input, sshPort: 65536 }))
	})

	it("ships a self-contained nonce protected webview without external assets", () => {
		const html = connectionPanelHtml("test-nonce")
		assert.ok(html.includes("default-src 'none'"))
		assert.ok(html.includes("script-src 'nonce-test-nonce'"))
		assert.ok(!html.includes("<script src="))
		assert.ok(html.includes("textContent=profile.name"))
	})
})
