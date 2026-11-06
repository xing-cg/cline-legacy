import type { ApiHandler } from "@core/api"

/**
 * Gets context window information for the given API handler
 *
 * @param api The API handler to get context window information for
 * @returns An object containing the raw context window size and the effective max allowed size
 */
export function getContextWindowInfo(api: ApiHandler) {
	// Respect configured model metadata, including DeepSeek behind compatible gateways.
	const configuredWindow = api.getModel().info.contextWindow
	const contextWindow = configuredWindow !== undefined && Number.isSafeInteger(configuredWindow) && configuredWindow > 0
		? configuredWindow
		: 128_000

	let maxAllowedSize: number
	switch (contextWindow) {
		case 64_000: // deepseek models
			maxAllowedSize = contextWindow - 27_000
			break
		case 128_000: // most models
			maxAllowedSize = contextWindow - 30_000
			break
		case 200_000: // claude models
			maxAllowedSize = contextWindow - 40_000
			break
		default:
			maxAllowedSize = Math.max(contextWindow - 40_000, contextWindow * 0.8) // for deepseek, 80% of 64k meant only ~10k buffer which was too small and resulted in users getting context window errors.
	}

	return { contextWindow, maxAllowedSize }
}
