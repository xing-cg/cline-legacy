import assert from "node:assert/strict";
import type {
	MessageCreateParamsStreaming,
	MessageParam,
} from "@anthropic-ai/sdk/resources/messages/messages";
import { getContextWindowInfo } from "@core/context/context-management/context-window-utils";
import { getAnthropicModelInfo, type ModelInfo } from "@shared/api";
import {
	convertApiConfigurationToProto,
	convertProtoToApiConfiguration,
} from "@shared/proto-conversions/models/api-configuration-conversion";
import {
	fromProtobufModelInfo,
	fromProtobufOpenAiCompatibleModelInfo,
} from "@shared/proto-conversions/models/typeConversion";
import { isNativeToolCallingConfig } from "@utils/model-utils";
import { afterEach, describe, it } from "mocha";
import sinon from "sinon";
import { AnthropicHandler, normalizeAnthropicBaseUrl } from "../anthropic";
import {
	createWithSonnet55Compatibility,
	prepareSonnet55Request,
} from "../anthropic-sonnet55";
import { OpenAiHandler } from "../openai";

const modelInfo: ModelInfo = {
	contextWindow: 1_000_000,
	maxTokens: 16_000,
	supportsPromptCache: false,
	supportsTools: true,
};
const makeBody = (
	messages: MessageParam[] = [{ role: "user", content: "Hello" }],
): MessageCreateParamsStreaming => ({
	model: "claude-sonnet-5-5",
	max_tokens: 8192,
	stream: true,
	messages,
});

describe("Legacy provider compatibility", () => {
	afterEach(() => sinon.restore());

	it("accepts Anthropic service roots or /v1 URLs with the same message endpoint", () => {
		assert.equal(
			normalizeAnthropicBaseUrl(" https://example.test/gateway/v1/ "),
			"https://example.test/gateway",
		);
		assert.equal(
			normalizeAnthropicBaseUrl("https://example.test/gateway/"),
			"https://example.test/gateway",
		);
		assert.equal(
			normalizeAnthropicBaseUrl("https://example.test/v1"),
			"https://example.test",
		);
		assert.equal(normalizeAnthropicBaseUrl(undefined), undefined);
	});

	it("honors configured DeepSeek context windows instead of compacting at 98k", () => {
		const handler = new OpenAiHandler({
			openAiModelId: "deepseek-v4.1-flash-1017",
			openAiModelInfo: modelInfo,
		});
		assert.deepEqual(getContextWindowInfo(handler), {
			contextWindow: 1_000_000,
			maxAllowedSize: 960_000,
		});
		const defaults = new OpenAiHandler({ openAiModelId: "deepseek-flash" });
		assert.deepEqual(getContextWindowInfo(defaults), {
			contextWindow: 128_000,
			maxAllowedSize: 98_000,
		});
	});

	it("falls back safely for invalid context limits while retaining valid presets", () => {
		for (const contextWindow of [NaN, Infinity, -1, 0, 1.5]) {
			const handler = new OpenAiHandler({ openAiModelId: "deepseek-flash", openAiModelInfo: { ...modelInfo, contextWindow } })
			assert.deepEqual(getContextWindowInfo(handler), { contextWindow: 128_000, maxAllowedSize: 98_000 })
		}
		for (const [contextWindow, maxAllowedSize] of [[64_000, 37_000], [128_000, 98_000], [200_000, 160_000]]) {
			const handler = new OpenAiHandler({ openAiModelId: "deepseek-flash", openAiModelInfo: { ...modelInfo, contextWindow } })
			assert.deepEqual(getContextWindowInfo(handler), { contextWindow, maxAllowedSize })
		}
	})

	it("recognizes newer DeepSeek IDs while preserving native tool opt-out", () => {
		for (const id of [
			"deepseek-flash",
			"deepseek-v4-pro",
			"deepseek-ai/DeepSeek-V4.1-Flash-1017",
			"DEEPSEEK_V4.1",
			"deepseek-1017",
		]) {
			const provider = {
				providerId: "openai",
				mode: "act" as const,
				model: { id, info: { supportsPromptCache: false } },
			};
			assert.equal(isNativeToolCallingConfig(provider, true), true, id);
			assert.equal(isNativeToolCallingConfig(provider, false), false, id);
		}
		const custom = {
			providerId: "anthropic",
			mode: "act" as const,
			model: { id: "service/custom", info: modelInfo },
		};
		assert.equal(isNativeToolCallingConfig(custom, true), true);
		assert.equal(
			isNativeToolCallingConfig(
				{
					...custom,
					model: {
						...custom.model,
						info: { ...modelInfo, supportsTools: false },
					},
				},
				true,
			),
			false,
		);
		assert.equal(
			isNativeToolCallingConfig({ ...custom, providerId: "unsupported" }, true),
			false,
		);
	});

	it("keeps custom Anthropic IDs and suffixes exact on the request", async () => {
		const handler = new AnthropicHandler({
			apiModelId: "company/model:1m:fast",
			anthropicModelInfo: modelInfo,
		});
		assert.equal(handler.getModel().id, "company/model:1m:fast");
		assert.equal(handler.getModel().info.contextWindow, 1_000_000);
		const create = sinon
			.stub()
			.resolves({ [Symbol.asyncIterator]: async function* () {} });
		sinon
			.stub(
				handler as unknown as { ensureClient: () => unknown },
				"ensureClient",
			)
			.returns({ messages: { create } });
		for await (const _ of handler.createMessage("system", [
			{ role: "user", content: "test" },
		])) {
		}
		assert.equal(create.firstCall.args[0].model, "company/model:1m:fast");
		assert.equal(create.firstCall.args[0].max_tokens, 16_000);
		assert.equal(create.firstCall.args[1], undefined);
	});

	it("does not use prototype properties as model presets and rejects invalid numeric overrides", () => {
		assert.equal(getAnthropicModelInfo("constructor").contextWindow, 128_000);
		assert.equal(
			getAnthropicModelInfo("custom", {
				supportsPromptCache: false,
				contextWindow: -1,
			}).contextWindow,
			128_000,
		);
		assert.equal(
			getAnthropicModelInfo("claude-sonnet-5-5").contextWindow,
			1_000_000,
		);
	});

	it("preserves custom capabilities through both protobuf conversion paths", () => {
		const proto = convertApiConfigurationToProto({
			planModeApiProvider: "anthropic",
			planModeApiModelId: "custom",
			planModeAnthropicModelInfo: modelInfo,
			actModeAnthropicModelInfo: { ...modelInfo, supportsTools: false },
			planModeOpenAiModelInfo: {
				...modelInfo,
				supportsStreaming: false,
				supportsReasoningEffort: true,
				systemRole: "developer",
				supportsReasoning: true,
			},
		});
		const restored = convertProtoToApiConfiguration(proto);
		assert.equal(restored.planModeAnthropicModelInfo?.contextWindow, 1_000_000);
		assert.equal(restored.planModeAnthropicModelInfo?.supportsTools, true);
		assert.equal(restored.actModeAnthropicModelInfo?.supportsTools, false);
		assert.equal(
			fromProtobufModelInfo(proto.actModeAnthropicModelInfo!).supportsTools,
			false,
		);
		for (const info of [
			restored.planModeOpenAiModelInfo!,
			fromProtobufOpenAiCompatibleModelInfo(proto.planModeOpenAiModelInfo!),
		]) {
			assert.equal(info.supportsTools, true);
			assert.equal(info.supportsStreaming, false);
			assert.equal(info.supportsReasoningEffort, true);
			assert.equal(info.systemRole, "developer");
			assert.equal(info.supportsReasoning, true);
		}
	});
});

describe("Sonnet 5.5 request compatibility", () => {
	it("uses adaptive thinking, removes sampling, preserves tools and the source body", () => {
		const body = {
			...makeBody(),
			temperature: 0,
			top_p: 0.8,
			top_k: 5,
			tool_choice: { type: "any" as const },
			tools: [{ name: "read_file", input_schema: { type: "object" as const } }],
		};
		const fixed = prepareSonnet55Request(body, "high") as unknown as Record<
			string,
			unknown
		>;
		assert.deepEqual(fixed.thinking, {
			type: "adaptive",
			display: "summarized",
		});
		assert.deepEqual(fixed.output_config, { effort: "high" });
		assert.deepEqual(fixed.tool_choice, { type: "auto" });
		assert.equal(fixed.tools, body.tools);
		assert.equal("temperature" in fixed, false);
		assert.equal("top_p" in fixed, false);
		assert.equal("top_k" in fixed, false);
		assert.equal(body.temperature, 0);
	});

	it("maps None to between-tools thinking without changing older models", () => {
		assert.deepEqual(prepareSonnet55Request(makeBody(), "none").thinking, {
			type: "between_tools",
		});
		const previous = {
			...makeBody(),
			model: "claude-sonnet-5",
			temperature: 0,
		};
		assert.equal(prepareSonnet55Request(previous, "none"), previous);
	});

	it("retries a prefix signature failure once, dropping only invalid and later thinking", async () => {
		const messages: MessageParam[] = [
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "", signature: "valid" },
					{ type: "text", text: "before" },
				],
			},
			{ role: "user", content: "continue" },
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "old", signature: "invalid" },
					{
						type: "tool_use",
						id: "t",
						name: "read_file",
						input: { path: "." },
					},
				],
			},
			{
				role: "user",
				content: [{ type: "tool_result", tool_use_id: "t", content: "result" }],
			},
			{
				role: "assistant",
				content: [
					{ type: "redacted_thinking", data: "later" },
					{ type: "text", text: "after" },
				],
			},
		];
		const original = JSON.stringify(messages);
		const create = sinon.stub();
		create
			.onFirstCall()
			.rejects(
				Object.assign(
					new Error("messages.2.content.0: prefix_binding_mismatch"),
					{ status: 400 },
				),
			);
		create.onSecondCall().resolves("stream");
		assert.equal(
			await createWithSonnet55Compatibility(
				makeBody(messages),
				"medium",
				create,
			),
			"stream",
		);
		assert.equal(create.callCount, 2);
		const retried = create.secondCall.args[0].messages as MessageParam[];
		assert.deepEqual(retried[0], messages[0]);
		assert.deepEqual(retried[2].content, [
			{ type: "tool_use", id: "t", name: "read_file", input: { path: "." } },
		]);
		assert.deepEqual(retried[3], messages[3]);
		assert.deepEqual(retried[4].content, [{ type: "text", text: "after" }]);
		assert.equal(JSON.stringify(messages), original);
	});

	it("does not retry unrelated errors or a second signature failure", async () => {
		for (const status of [400, 401, 429]) {
			const error = Object.assign(new Error("unrelated"), { status });
			const create = sinon.stub().rejects(error);
			await assert.rejects(
				createWithSonnet55Compatibility(makeBody(), "medium", create),
				error,
			);
			assert.equal(create.callCount, 1);
		}
		const error = Object.assign(new Error("prefix_binding_mismatch"), {
			status: 400,
		});
		const create = sinon.stub().rejects(error);
		await assert.rejects(
			createWithSonnet55Compatibility(
				makeBody([
					{
						role: "assistant",
						content: [
							{ type: "thinking", thinking: "old", signature: "old" },
							{ type: "text", text: "text" },
						],
					},
				]),
				"medium",
				create,
			),
			error,
		);
		assert.equal(create.callCount, 2);
	});
});
