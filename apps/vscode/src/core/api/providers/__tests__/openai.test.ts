import "should"
import type OpenAI from "openai"
import sinon from "sinon"
import type { ApiStreamChunk } from "../../transform/stream"
import { OpenAiHandler } from "../openai"

describe("OpenAiHandler", () => {
	afterEach(() => {
		sinon.restore()
	})

	const createAsyncIterable = (data: unknown[] = []) => ({
		[Symbol.asyncIterator]: async function* () {
			yield* data
		},
	})

	const createHandler = (chunks: unknown[], modelId = "test-model") => {
		const handler = new OpenAiHandler({
			openAiApiKey: "test-api-key",
			openAiModelId: modelId,
		})
		const fakeClient = {
			chat: {
				completions: {
					create: sinon.stub().resolves(createAsyncIterable(chunks)),
				},
			},
		}
		sinon.stub(handler as unknown as { ensureClient: () => OpenAI }, "ensureClient").returns(fakeClient as unknown as OpenAI)
		return handler
	}

	const cacheCases = [
		{
			name: "prompt detail writes",
			usage: { prompt_tokens_details: { cache_write_tokens: 5015 } },
			reads: 0,
			writes: 5015,
		},
		{
			name: "input detail writes",
			usage: { input_tokens_details: { cache_write_tokens: 5015 } },
			reads: 0,
			writes: 5015,
		},
		{
			name: "top-level writes",
			usage: { cache_write_tokens: 5015 },
			reads: 0,
			writes: 5015,
		},
		{
			name: "cache creation writes",
			usage: { cache_creation_input_tokens: 5015 },
			reads: 0,
			writes: 5015,
		},
		{
			name: "input detail read fallback",
			usage: {
				prompt_tokens_details: null,
				input_tokens_details: { cached_tokens: 5015 },
			},
			reads: 5015,
			writes: 0,
		},
		{
			name: "cache hit fallback",
			usage: { prompt_cache_hit_tokens: 5015 },
			reads: 5015,
			writes: 0,
		},
		{
			name: "duplicate detail aliases counted once",
			usage: {
				prompt_tokens_details: { cached_tokens: 5015, cache_write_tokens: 3 },
				input_tokens_details: { cached_tokens: 5015, cache_write_tokens: 3 },
				cache_write_tokens: 3,
			},
			reads: 5015,
			writes: 3,
		},
		{
			name: "cache misses are not writes",
			usage: { prompt_cache_miss_tokens: 5018 },
			reads: 0,
			writes: 0,
		},
		{
			name: "explicit zero takes precedence",
			usage: {
				prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
				input_tokens_details: { cached_tokens: 5015, cache_write_tokens: 5015 },
			},
			reads: 0,
			writes: 0,
		},
		{
			name: "invalid values use a valid fallback",
			usage: {
				prompt_tokens_details: {
					cached_tokens: -1,
					cache_write_tokens: "5015",
				},
				input_tokens_details: { cached_tokens: 5015, cache_write_tokens: 5015 },
			},
			reads: 5015,
			writes: 5015,
		},
	]
	for (const testCase of cacheCases) {
		it(`should report ${testCase.name} for gpt-6.1-sol`, async () => {
			const handler = createHandler(
				[
					{
						choices: [],
						usage: {
							prompt_tokens: 5018,
							completion_tokens: 1,
							...testCase.usage,
						},
					},
				],
				"gpt-6.1-sol",
			)
			const chunks: ApiStreamChunk[] = []
			for await (const chunk of handler.createMessage("system", [{ role: "user", content: "hi" }])) chunks.push(chunk)
			chunks.should.deepEqual([
				{
					type: "usage",
					inputTokens: Math.max(0, 5018 - testCase.reads - testCase.writes),
					outputTokens: 1,
					cacheReadTokens: testCase.reads,
					cacheWriteTokens: testCase.writes,
				},
			])
		})
	}

	it("should emit the latest cumulative usage snapshot only once", async () => {
		const handler = createHandler([
			{
				choices: [{ delta: { content: "O" } }],
				usage: {
					prompt_tokens: 48,
					completion_tokens: 1,
					total_tokens: 49,
					prompt_tokens_details: { cached_tokens: 32 },
				},
			},
			{
				choices: [{ delta: { content: "K" } }],
				usage: {
					prompt_tokens: 48,
					completion_tokens: 2,
					total_tokens: 50,
					prompt_tokens_details: { cached_tokens: 32 },
				},
			},
			{ choices: [{ delta: {}, finish_reason: "stop" }], usage: null },
		])

		const chunks: ApiStreamChunk[] = []
		for await (const chunk of handler.createMessage("system", [{ role: "user", content: "hi" }])) {
			chunks.push(chunk)
		}

		chunks.should.deepEqual([
			{ type: "text", text: "O" },
			{ type: "text", text: "K" },
			{
				type: "usage",
				inputTokens: 16,
				outputTokens: 2,
				cacheReadTokens: 32,
				cacheWriteTokens: 0,
			},
		])
	})

	it("should preserve providers that emit usage only on the final chunk", async () => {
		const handler = createHandler([
			{ choices: [{ delta: { content: "OK" } }] },
			{
				choices: [],
				usage: {
					prompt_tokens: 17,
					completion_tokens: 9,
					total_tokens: 26,
				},
			},
		])

		const chunks: ApiStreamChunk[] = []
		for await (const chunk of handler.createMessage("system", [{ role: "user", content: "hi" }])) {
			chunks.push(chunk)
		}

		chunks.should.deepEqual([
			{ type: "text", text: "OK" },
			{
				type: "usage",
				inputTokens: 17,
				outputTokens: 9,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
			},
		])
	})
})
