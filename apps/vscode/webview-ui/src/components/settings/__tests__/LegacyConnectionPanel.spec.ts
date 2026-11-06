import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { connectionPanelHtml } from "../../../../../src/hosts/vscode/legacy/connection-panel-html"

const profile = {
	id: "saved-profile",
	name: "<img src=x onerror=alert(1)>",
	tokenGroup: "标准组",
	provider: "openai",
	baseUrl: "https://service.example/v1",
	modelId: "my-model",
	contextWindow: 1_000_000,
	maxTokens: 8192,
	supportsTools: true,
	supportsImages: false,
	supportsPromptCache: false,
	hasKey: true,
}

describe("legacy standalone connection panel", () => {
	const postMessage = vi.fn()
	const listeners: Array<EventListenerOrEventListenerObject> = []
	const input = (id: string) => document.getElementById(id) as HTMLInputElement
	const button = (id: string) => document.getElementById(id) as HTMLButtonElement
	const receive = (data: object) => window.dispatchEvent(new MessageEvent("message", { data }))
	const submit = (id: string) =>
		document.getElementById(id)?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))

	beforeEach(() => {
		postMessage.mockClear()
		const originalAdd = window.addEventListener.bind(window)
		vi.spyOn(window, "addEventListener").mockImplementation((type, listener, options) => {
			if (type === "message") listeners.push(listener)
			originalAdd(type, listener, options)
		})
		const parsed = new DOMParser().parseFromString(connectionPanelHtml("test-nonce"), "text/html")
		document.body.innerHTML = parsed.body.innerHTML
		const script = parsed.querySelector("script")?.textContent || ""
		new Function("acquireVsCodeApi", script)(() => ({ postMessage }))
		receive({ type: "state", profiles: [profile], environment: "ssh-remote · linux", selectedId: profile.id })
	})

	afterEach(() => {
		for (const listener of listeners.splice(0)) window.removeEventListener("message", listener)
		vi.restoreAllMocks()
		document.body.replaceChildren()
	})

	it("renders profile names as text and never returns a stored API key to the password field", () => {
		expect(postMessage).toHaveBeenCalledWith({ action: "ready" })
		expect(document.getElementById("profiles")?.textContent).toContain(profile.name)
		expect(document.querySelector("#profiles img")).toBeNull()
		expect(input("apiKey").value).toBe("")
		expect(document.getElementById("key-state")?.textContent).toContain("已保存 Key")
		expect(button("apply").disabled).toBe(false)
	})

	it("requires saving edits, sends the credential only on save, then applies the returned identity", () => {
		input("name").value = "更新名称"
		input("apiKey").value = "test-key-only-for-save"
		input("name").dispatchEvent(new Event("input", { bubbles: true }))
		expect(button("apply").disabled).toBe(true)
		submit("profile-form")
		expect(postMessage).toHaveBeenLastCalledWith(
			expect.objectContaining({
				action: "save",
				apiKey: "test-key-only-for-save",
				profile: expect.objectContaining({ id: profile.id, name: "更新名称" }),
			}),
		)
		receive({
			type: "state",
			profiles: [{ ...profile, id: "rotated-id" }],
			selectedId: "rotated-id",
			environment: "linux",
			notice: "已保存",
		})
		expect(input("apiKey").value).toBe("")
		input("target").value = "act"
		button("apply").click()
		expect(postMessage).toHaveBeenLastCalledWith({ action: "apply", id: "rotated-id", target: "act" })
		receive({ type: "result", error: true, message: "任务正在请求" })
		expect(button("apply").disabled).toBe(false)
		expect(document.getElementById("status")?.textContent).toBe("任务正在请求")
	})

	it("can create a new Anthropic profile and changes the endpoint hint without changing user input", () => {
		button("new").click()
		expect(input("name").value).toBe("")
		expect(button("delete").disabled).toBe(true)
		input("provider").value = "anthropic"
		input("baseUrl").value = "https://custom.example/prefix"
		input("provider").dispatchEvent(new Event("change", { bubbles: true }))
		expect(input("baseUrl").placeholder).toBe("https://service.example")
		expect(input("baseUrl").value).toBe("https://custom.example/prefix")
	})

	it("generates and copies SSH previews only through explicit messages", () => {
		for (const [id, value] of Object.entries({
			host: "10.0.0.2",
			user: "developer",
			sshPort: "22",
			localServicePort: "8000",
			remoteListenPort: "18000",
		}))
			input(id).value = value
		submit("ssh-form")
		expect(postMessage).toHaveBeenLastCalledWith({
			action: "ssh",
			ssh: { host: "10.0.0.2", user: "developer", sshPort: "22", localServicePort: "8000", remoteListenPort: "18000" },
		})
		receive({ type: "result", message: "生成成功", ssh: "Host example\n    RemoteForward 127.0.0.1:18000 127.0.0.1:8000" })
		expect(input("ssh-output").value).toContain("RemoteForward")
		button("copy-ssh").click()
		expect(postMessage).toHaveBeenLastCalledWith({ action: "copySsh" })
	})

	it("keeps default and vip lists separate and ignores the previous group's delayed response", () => {
		const vip = { ...profile, id: "vip-id", name: "VIP connection", tokenGroup: "vip" }
		receive({ type: "state", profiles: [{ ...profile, tokenGroup: "default" }, vip], selectedId: profile.id })
		button("fetch-models").click()
		const standardRequest = postMessage.mock.lastCall?.[0]
		expect(standardRequest.draft).toMatchObject({ id: profile.id, apiKey: "" })
		document.querySelectorAll<HTMLButtonElement>("#profiles button")[1].click()
		expect(input("discovered-models").disabled).toBe(true)
		button("fetch-models").click()
		const vipRequest = postMessage.mock.lastCall?.[0]
		expect(vipRequest.requestId).not.toBe(standardRequest.requestId)
		expect(vipRequest.draft.id).toBe("vip-id")
		receive({ type: "models", requestId: standardRequest.requestId, models: ["default-only"] })
		expect(document.getElementById("discovered-models")?.textContent).not.toContain("default-only")
		receive({ type: "models", requestId: vipRequest.requestId, models: ["vip-only"] })
		expect(document.getElementById("discovered-models")?.textContent).toContain("vip-only")
		input("discovered-models").value = "vip-only"
		input("discovered-models").dispatchEvent(new Event("change", { bubbles: true }))
		expect(input("modelId").value).toBe("vip-only")
		expect(button("apply").disabled).toBe(true)
	})

	it("invalidates model responses on credential or endpoint edits without automatically fetching", () => {
		button("fetch-models").click()
		const request = postMessage.mock.lastCall?.[0]
		const beforeEdit = postMessage.mock.calls.length
		input("apiKey").value = "new-token"
		input("apiKey").dispatchEvent(new Event("input", { bubbles: true }))
		expect(postMessage.mock.calls.length).toBe(beforeEdit)
		receive({ type: "models", requestId: request.requestId, models: ["old-key-model"] })
		expect(document.getElementById("discovered-models")?.textContent).not.toContain("old-key-model")
		button("fetch-models").click()
		const newRequest = postMessage.mock.lastCall?.[0]
		expect(newRequest.draft.apiKey).toBe("new-token")
		input("baseUrl").value = "https://another.example/v1"
		input("baseUrl").dispatchEvent(new Event("input", { bubbles: true }))
		receive({ type: "models", requestId: newRequest.requestId, models: ["old-address-model"] })
		expect(document.getElementById("discovered-models")?.textContent).not.toContain("old-address-model")
	})

	it("requests a new draft before a model is known and shows missing-key errors and empty lists", () => {
		button("new").click()
		input("baseUrl").value = "https://draft.example/v1"
		button("fetch-models").click()
		const missingKeyRequest = postMessage.mock.lastCall?.[0]
		expect(missingKeyRequest.draft).toEqual({ provider: "openai", baseUrl: "https://draft.example/v1", apiKey: "" })
		receive({ type: "models", requestId: missingKeyRequest.requestId, error: "请填写当前分组的 API Key" })
		expect(document.getElementById("model-status")?.textContent).toContain("请填写")
		expect(button("fetch-models").disabled).toBe(false)
		input("apiKey").value = "draft-key"
		input("apiKey").dispatchEvent(new Event("input", { bubbles: true }))
		button("fetch-models").click()
		const draftRequest = postMessage.mock.lastCall?.[0]
		expect(draftRequest.draft.apiKey).toBe("draft-key")
		expect(draftRequest.draft.id).toBeUndefined()
		receive({ type: "models", requestId: draftRequest.requestId, models: [] })
		expect(document.getElementById("model-status")?.textContent).toContain("请求成功")
		expect(input("discovered-models").disabled).toBe(true)
	})
})
