import { fetch as configuredFetch } from "@/shared/net"

export interface ModelDiscoveryRequest {
	baseUrl: string
	apiKey?: string
	headers?: Record<string, string>
	protocol?: string
}

const TIMEOUT_MS = 15_000
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_PAGES = 20

// Only these locally generated errors cross the extension/webview boundary.
// Provider bodies and fetch errors can contain credentials, so never forward them.
class ModelDiscoveryError extends Error {
	constructor(message: string) {
		super(`Model discovery: ${message}`)
	}
}

export function modelDiscoveryUrl(baseUrl: string, protocol = "openai"): URL {
	if (protocol !== "openai" && protocol !== "anthropic") {
		throw new ModelDiscoveryError("Unsupported API protocol.")
	}
	let url: URL
	try {
		url = new URL(baseUrl.trim())
	} catch {
		throw new ModelDiscoveryError("Enter a valid HTTP or HTTPS Base URL.")
	}
	if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) {
		throw new ModelDiscoveryError("Use an HTTP or HTTPS Base URL without credentials, query parameters or a fragment.")
	}
	const path = url.pathname.replace(/\/+$/, "")
	// Preserve OpenAI API prefixes exactly as the chat SDK does (including a bare origin).
	// Anthropic SDK base URLs point to the service root; accept an existing /v1 too.
	const prefix = protocol === "anthropic" && !path.endsWith("/v1") ? `${path}/v1` : path
	url.pathname = `${prefix}/models`
	return url
}

export function modelDiscoveryHeaders(request: ModelDiscoveryRequest): Headers {
	let headers: Headers
	try {
		headers = new Headers(request.headers)
	} catch {
		throw new ModelDiscoveryError("A custom header is invalid. Check header names and values.")
	}
	if (!headers.has("accept")) {
		headers.set("accept", "application/json")
	}
	try {
		if (request.protocol === "anthropic") {
			if (request.apiKey && !headers.has("x-api-key")) {
				headers.set("x-api-key", request.apiKey)
			}
			if (!headers.has("anthropic-version")) {
				headers.set("anthropic-version", "2023-06-01")
			}
		} else if (request.apiKey && !headers.has("authorization")) {
			headers.set("authorization", `Bearer ${request.apiKey}`)
		}
	} catch {
		throw new ModelDiscoveryError("An API key or custom header contains invalid characters.")
	}
	return headers
}

function validModelId(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= 1024 &&
		value.trim() === value &&
		![...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
	)
}

export function parseDiscoveredModels(body: unknown): string[] {
	if (!body || typeof body !== "object" || !Array.isArray((body as { data?: unknown }).data)) {
		throw new ModelDiscoveryError("The endpoint did not return a model list. Check its Base URL and API protocol.")
	}
	const data = (body as { data: unknown[] }).data
	return [
		...new Set(
			data.flatMap((entry) => {
				if (!entry || typeof entry !== "object") {
					return []
				}
				const id = (entry as { id?: unknown }).id
				return validModelId(id) ? [id] : []
			}),
		),
	].sort()
}

async function readJson(response: Response): Promise<unknown> {
	if (Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES) {
		await response.body?.cancel()
		throw new ModelDiscoveryError("The model list response is too large.")
	}
	// Enforce the limit while streaming, not only after buffering the response.
	if (!response.body) {
		throw new ModelDiscoveryError("The endpoint returned an empty response.")
	}
	const reader = response.body.getReader()
	const chunks: Uint8Array[] = []
	let length = 0
	try {
		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			length += value.byteLength
			if (length > MAX_RESPONSE_BYTES) {
				await reader.cancel()
				throw new ModelDiscoveryError("The model list response is too large.")
			}
			chunks.push(value)
		}
	} finally {
		reader.releaseLock()
	}
	const bytes = new Uint8Array(length)
	let offset = 0
	for (const chunk of chunks) {
		bytes.set(chunk, offset)
		offset += chunk.byteLength
	}
	try {
		return JSON.parse(new TextDecoder().decode(bytes))
	} catch {
		throw new ModelDiscoveryError("The endpoint returned invalid JSON. Check its Base URL.")
	}
}

/** Runs only when explicitly requested, in the extension host (including Remote SSH). */
export async function discoverModels(
	request: ModelDiscoveryRequest,
	fetchImpl: typeof globalThis.fetch = configuredFetch,
	timeoutMs = TIMEOUT_MS,
): Promise<string[]> {
	const protocol = request.protocol || "openai"
	const url = modelDiscoveryUrl(request.baseUrl, protocol)
	const headers = modelDiscoveryHeaders({ ...request, protocol })
	const abort = new AbortController()
	const timeout = setTimeout(() => abort.abort(), timeoutMs)
	const models = new Set<string>()
	const cursors = new Set<string>()
	try {
		if (protocol === "anthropic") url.searchParams.set("limit", "1000")
		for (let page = 0; page < MAX_PAGES; page++) {
			const response = await fetchImpl(url, { method: "GET", headers, signal: abort.signal, redirect: "error" })
			if (!response.ok) {
				// Never read or log an error body; intermediaries may echo request headers.
				void response.body?.cancel().catch(() => {})
				if (response.status === 401 || response.status === 403) {
					throw new ModelDiscoveryError(
						`HTTP ${response.status}. Check the API key, token group and model-list permission.`,
					)
				}
				if (response.status === 404 || response.status === 405) {
					throw new ModelDiscoveryError(
						`HTTP ${response.status}. This endpoint may not support model listing; enter the Model ID manually.`,
					)
				}
				throw new ModelDiscoveryError(`HTTP ${response.status}. The provider did not return a model list.`)
			}
			const body = await readJson(response)
			for (const id of parseDiscoveredModels(body)) models.add(id)
			const pagination = body as { has_more?: unknown; last_id?: unknown }
			if (protocol !== "anthropic" || pagination.has_more !== true) return [...models].sort()
			if (!validModelId(pagination.last_id) || cursors.has(pagination.last_id)) {
				throw new ModelDiscoveryError("The provider returned invalid model-list pagination.")
			}
			cursors.add(pagination.last_id)
			url.searchParams.set("after_id", pagination.last_id)
		}
		throw new ModelDiscoveryError("The provider returned too many model-list pages.")
	} catch (error) {
		if (error instanceof ModelDiscoveryError) throw error
		if (abort.signal.aborted) throw new ModelDiscoveryError("Request timed out. Check connectivity from the extension host.")
		throw new ModelDiscoveryError(
			"Connection failed. Check the extension host network, certificates and Base URL. Redirects are not followed.",
		)
	} finally {
		clearTimeout(timeout)
	}
}
