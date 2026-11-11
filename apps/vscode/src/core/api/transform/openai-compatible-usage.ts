function record(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function tokenCount(...values: unknown[]): number {
	for (const value of values) {
		if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value
	}
	return 0
}

/** Read alternative gateway representations once; cache misses are not cache writes. */
export function getOpenAiCompatibleCacheUsage(usage: unknown): {
	cacheReadTokens: number
	cacheWriteTokens: number
} {
	const value = record(usage)
	const prompt = record(value.prompt_tokens_details)
	const input = record(value.input_tokens_details)
	return {
		cacheReadTokens: tokenCount(prompt.cached_tokens, input.cached_tokens, value.prompt_cache_hit_tokens),
		cacheWriteTokens: tokenCount(
			prompt.cache_write_tokens,
			input.cache_write_tokens,
			value.cache_write_tokens,
			value.cache_creation_input_tokens,
		),
	}
}
