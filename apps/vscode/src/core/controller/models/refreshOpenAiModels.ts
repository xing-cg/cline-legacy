import { StringArray } from "@shared/proto/cline/common"
import { OpenAiModelsRequest } from "@shared/proto/cline/models"
import { discoverModels } from "@/services/models/discovery"
import type { Controller } from ".."

/**
 * Fetches available models from the OpenAI API
 * @param controller The controller instance
 * @param request Request containing the base URL and API key
 * @returns Array of model names
 */
export async function refreshOpenAiModels(_controller: Controller, request: OpenAiModelsRequest): Promise<StringArray> {
	return StringArray.create({ values: await discoverModels(request) })
}
