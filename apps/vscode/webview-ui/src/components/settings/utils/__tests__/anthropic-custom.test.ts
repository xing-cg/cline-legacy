import type { ApiConfiguration, ModelInfo } from "@shared/api";
import { describe, expect, it, vi } from "vitest";
import {
	normalizeApiConfiguration,
	syncModeConfigurations,
} from "../providerUtils";

describe("custom Anthropic configuration", () => {
	const info: ModelInfo = {
		contextWindow: 1_000_000,
		maxTokens: 32_000,
		supportsPromptCache: false,
		supportsTools: true,
	};
	const config: ApiConfiguration = {
		actModeApiProvider: "anthropic",
		actModeApiModelId: "gateway/private-model",
		actModeAnthropicModelInfo: info,
	};

	it("shows the configured custom ID and context instead of a built-in fallback", () => {
		const normalized = normalizeApiConfiguration(config, "act");
		expect(normalized.selectedModelId).toBe("gateway/private-model");
		expect(normalized.selectedModelInfo).toMatchObject(info);
	});

	it("copies model metadata when Plan and Act are linked", async () => {
		const update = vi.fn().mockResolvedValue(undefined);
		await syncModeConfigurations(config, "act", update);
		expect(update).toHaveBeenCalledWith(
			expect.objectContaining({
				planModeApiModelId: "gateway/private-model",
				actModeApiModelId: "gateway/private-model",
				planModeAnthropicModelInfo: info,
				actModeAnthropicModelInfo: info,
			}),
		);
	});
});
