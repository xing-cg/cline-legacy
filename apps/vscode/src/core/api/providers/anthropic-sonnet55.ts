import type {
	MessageCreateParamsStreaming,
	MessageParam,
} from "@anthropic-ai/sdk/resources/messages/messages";

// Kept at the request boundary so the pinned SDK can send the newer model's
// options without changing request behavior for any other model.
export function prepareSonnet55Request(
	body: MessageCreateParamsStreaming,
	reasoningEffort?: string,
): MessageCreateParamsStreaming {
	if (body.model !== "claude-sonnet-5-5") {
		return body;
	}
	const original = body as MessageCreateParamsStreaming & {
		output_config?: { effort?: string };
	};
	const requestedEffort =
		original.output_config?.effort || reasoningEffort || "medium";
	const thinkingType = (body.thinking as { type?: string } | undefined)?.type;
	const betweenTools =
		requestedEffort === "none" ||
		thinkingType === "disabled" ||
		thinkingType === "between_tools";
	let effort = ["low", "medium", "high", "xhigh", "max"].includes(
		requestedEffort,
	)
		? requestedEffort
		: "medium";
	if (betweenTools && (effort === "xhigh" || effort === "max")) {
		effort = "high";
	}
	const result: Record<string, unknown> = {
		...body,
		thinking: betweenTools
			? { type: "between_tools" }
			: { type: "adaptive", display: "summarized" },
		output_config: { ...original.output_config, effort },
	};
	delete result.temperature;
	delete result.top_p;
	delete result.top_k;
	if (body.tool_choice?.type === "any" || body.tool_choice?.type === "tool") {
		result.tool_choice = { type: "auto" };
	}
	return result as unknown as MessageCreateParamsStreaming;
}

function removeInvalidThinking(
	messages: MessageParam[],
	messageIndex: number | undefined,
	blockIndex: number,
): MessageParam[] | undefined {
	let changed = false;
	const next = messages
		.map((message, index) => {
			if (!Array.isArray(message.content)) {
				return message;
			}
			const content = message.content.filter((block, offset) => {
				const thinking =
					block.type === "thinking" || block.type === "redacted_thinking";
				const atOrAfter =
					messageIndex === undefined ||
					index > messageIndex ||
					(index === messageIndex && offset >= blockIndex);
				if (thinking && atOrAfter) {
					changed = true;
					return false;
				}
				return true;
			});
			return content.length === message.content.length
				? message
				: { ...message, content };
		})
		.filter(
			(message) =>
				!Array.isArray(message.content) || message.content.length > 0,
		);
	return changed ? next : undefined;
}

/** One recovery attempt for a signature invalidated by legacy history compaction. */
export async function createWithSonnet55Compatibility<T>(
	body: MessageCreateParamsStreaming,
	reasoningEffort: string | undefined,
	create: (body: MessageCreateParamsStreaming) => PromiseLike<T>,
): Promise<T> {
	const request = prepareSonnet55Request(body, reasoningEffort);
	try {
		return await create(request);
	} catch (error) {
		const message = String(error?.message || "");
		if (
			body.model !== "claude-sonnet-5-5" ||
			error?.status !== 400 ||
			!/bound to a different conversation|prefix_binding_mismatch|invalid[^\n]*signature[^\n]*thinking/i.test(
				message,
			)
		) {
			throw error;
		}
		const position = /messages\.(\d+)\.content\.(\d+)/.exec(message);
		const messages = removeInvalidThinking(
			request.messages,
			position ? Number(position[1]) : undefined,
			position ? Number(position[2]) : 0,
		);
		if (!messages) {
			throw error;
		}
		return await create({ ...request, messages });
	}
}
