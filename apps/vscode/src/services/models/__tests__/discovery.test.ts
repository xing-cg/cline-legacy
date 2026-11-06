import { expect } from "chai"
import { describe, it } from "mocha"
import { discoverModels, modelDiscoveryHeaders, modelDiscoveryUrl, parseDiscoveredModels } from "../discovery"

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const request = { baseUrl: "https://gateway.example/v1/", apiKey: "secret-key" }

async function errorMessage(run: Promise<unknown>): Promise<string> {
	try {
		await run
		throw new Error("Expected rejection")
	} catch (error) {
		if (!(error instanceof Error) || error.message === "Expected rejection") throw error
		return error.message
	}
}

describe("model discovery", () => {
	it("normalizes roots and trailing slashes while preserving custom prefixes", () => {
		expect(modelDiscoveryUrl("https://gateway.example/").href).to.equal("https://gateway.example/models")
		expect(modelDiscoveryUrl("https://gateway.example/", "anthropic").href).to.equal("https://gateway.example/v1/models")
		expect(modelDiscoveryUrl("https://gateway.example/v1///").href).to.equal("https://gateway.example/v1/models")
		expect(modelDiscoveryUrl("https://gateway.example/proxy/openai/").href).to.equal(
			"https://gateway.example/proxy/openai/models",
		)
		expect(modelDiscoveryUrl("https://gateway.example/anthropic/", "anthropic").href).to.equal(
			"https://gateway.example/anthropic/v1/models",
		)
		expect(modelDiscoveryUrl("https://gateway.example/v1/", "anthropic").href).to.equal("https://gateway.example/v1/models")
	})

	it("rejects invalid URLs and unsupported protocols before sending credentials", () => {
		for (const baseUrl of [
			"",
			"not a URL",
			"file:///tmp/api",
			"https://user:pass@gateway.example",
			"https://gateway.example/?key=secret",
			"https://gateway.example/#secret",
		]) {
			expect(() => modelDiscoveryUrl(baseUrl)).to.throw("Model discovery:")
		}
		expect(() => modelDiscoveryUrl(request.baseUrl, "unrecognized")).to.throw("Unsupported API protocol")
	})

	it("filters malformed IDs, preserves valid IDs verbatim, sorts and deduplicates", () => {
		expect(
			parseDiscoveredModels({
				data: [
					{ id: "z" },
					{ id: "vendor/model:1m" },
					{ id: "a" },
					{ id: "z" },
					{ id: "" },
					{ id: " a" },
					{ id: "a\n" },
					{ id: 12 },
					{},
					null,
					"a",
				],
			}),
		).to.deep.equal(["a", "vendor/model:1m", "z"])
		expect(parseDiscoveredModels({ data: [] })).to.deep.equal([])
		for (const body of [null, {}, { error: "bad" }, { data: "wrong" }]) {
			expect(() => parseDiscoveredModels(body)).to.throw("did not return a model list")
		}
	})

	it("uses custom headers, including case-insensitive auth overrides, consistently", () => {
		const headers = modelDiscoveryHeaders({
			...request,
			headers: { authorization: "Bearer group-key", "X-Token-Group": "fast" },
		})
		expect(headers.get("Authorization")).to.equal("Bearer group-key")
		expect(headers.get("X-Token-Group")).to.equal("fast")
		const anthropic = modelDiscoveryHeaders({ ...request, protocol: "anthropic" })
		expect(anthropic.get("x-api-key")).to.equal("secret-key")
		expect(anthropic.get("anthropic-version")).to.equal("2023-06-01")
		expect(anthropic.has("authorization")).to.equal(false)
		expect(() => modelDiscoveryHeaders({ ...request, headers: { "bad\nheader": "secret-value" } })).to.throw(
			"A custom header is invalid",
		)
	})

	it("sends GET from the host, includes supplied headers and refuses redirects", async () => {
		let calls = 0
		const result = await discoverModels({ ...request, headers: { "X-Token-Group": "group-a" } }, async (url, init) => {
			calls++
			expect(String(url)).to.equal("https://gateway.example/v1/models")
			expect(init?.method).to.equal("GET")
			expect(init?.redirect).to.equal("error")
			expect(init?.signal).to.be.instanceOf(AbortSignal)
			expect(new Headers(init?.headers).get("authorization")).to.equal("Bearer secret-key")
			expect(new Headers(init?.headers).get("x-token-group")).to.equal("group-a")
			return json({ data: [{ id: "model-b" }, { id: "model-a" }] })
		})
		expect(calls).to.equal(1)
		expect(result).to.deep.equal(["model-a", "model-b"])
	})

	it("follows Anthropic cursors without changing the host or exposing credentials in URLs", async () => {
		const urls: string[] = []
		const result = await discoverModels({ ...request, protocol: "anthropic" }, async (url, init) => {
			urls.push(String(url))
			expect(new Headers(init?.headers).get("x-api-key")).to.equal("secret-key")
			return urls.length === 1
				? json({ data: [{ id: "a" }], has_more: true, last_id: "a" })
				: json({ data: [{ id: "b" }, { id: "a" }], has_more: false })
		})
		expect(urls).to.deep.equal([
			"https://gateway.example/v1/models?limit=1000",
			"https://gateway.example/v1/models?limit=1000&after_id=a",
		])
		expect(result).to.deep.equal(["a", "b"])
	})

	it("fails rather than silently returning partial results on invalid pagination", async () => {
		let calls = 0
		const message = await errorMessage(
			discoverModels({ ...request, protocol: "anthropic" }, async () => {
				calls++
				return json({ data: [{ id: "a" }], has_more: true, last_id: "a" })
			}),
		)
		expect(calls).to.equal(2)
		expect(message).to.include("invalid model-list pagination")
	})

	it("distinguishes an empty model list from HTTP and malformed-response errors", async () => {
		expect(await discoverModels(request, async () => json({ data: [] }))).to.deep.equal([])
		const forbidden = await errorMessage(discoverModels(request, async () => json({ error: "secret-key raw header" }, 403)))
		expect(forbidden).to.include("HTTP 403")
		expect(forbidden).not.to.include("secret-key")
		const notFound = await errorMessage(discoverModels(request, async () => json({}, 404)))
		expect(notFound).to.include("enter the Model ID manually")
		const malformed = await errorMessage(discoverModels(request, async () => new Response("<html>secret-key</html>")))
		expect(malformed).to.include("invalid JSON")
		expect(malformed).not.to.include("secret-key")
	})

	it("sanitizes network errors and aborts a stalled request", async () => {
		const message = await errorMessage(
			discoverModels(request, async () => {
				throw new Error("failed Authorization=secret-key")
			}),
		)
		expect(message).to.include("Connection failed")
		expect(message).not.to.include("secret-key")
		const timeout = await errorMessage(
			discoverModels(
				request,
				(_url, init) =>
					new Promise((_resolve, reject) => {
						init?.signal?.addEventListener("abort", () => reject(new Error("secret-key")), { once: true })
					}),
				5,
			),
		)
		expect(timeout).to.include("Request timed out")
		expect(timeout).not.to.include("secret-key")
	})

	it("limits streamed responses without trusting Content-Length", async () => {
		const message = await errorMessage(discoverModels(request, async () => new Response("x".repeat(2 * 1024 * 1024 + 1))))
		expect(message).to.include("response is too large")
	})
})
