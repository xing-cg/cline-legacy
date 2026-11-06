import { ANTHROPIC_FAST_MODE_SUFFIX, anthropicModels, CLAUDE_SONNET_1M_SUFFIX, getAnthropicModelInfo, type ModelInfo } from "@shared/api"
import type { Mode } from "@shared/storage/types"
import { isClaudeOpusAdaptiveThinkingModel, resolveClaudeOpusAdaptiveThinking } from "@shared/utils/reasoning-support"
import { VSCodeButton, VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ApiKeyField } from "../common/ApiKeyField"
import { BaseUrlField } from "../common/BaseUrlField"
import { ContextWindowSwitcher } from "../common/ContextWindowSwitcher"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelDiscovery } from "../common/ModelDiscovery"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import { RemotelyConfiguredInputWrapper } from "../common/RemotelyConfiguredInputWrapper"
import ReasoningEffortSelector from "../ReasoningEffortSelector"
import ThinkingBudgetSlider from "../ThinkingBudgetSlider"
import { getModeSpecificFields, normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

// Anthropic models that support thinking/reasoning mode
export const SUPPORTED_ANTHROPIC_THINKING_MODELS = [
	"claude-sonnet-5",
	`claude-sonnet-5${CLAUDE_SONNET_1M_SUFFIX}`,
	"claude-sonnet-4-6",
	`claude-sonnet-4-6${CLAUDE_SONNET_1M_SUFFIX}`,
	"claude-3-7-sonnet-20250219",
	"claude-sonnet-4-20250514",
	`claude-sonnet-4-20250514${CLAUDE_SONNET_1M_SUFFIX}`,
	"claude-opus-4-20250514",
	"claude-opus-4-1-20250805",
	"claude-sonnet-4-5-20250929",
	`claude-sonnet-4-5-20250929${CLAUDE_SONNET_1M_SUFFIX}`,
	"claude-haiku-4-5-20251001",
]

/**
 * Props for the AnthropicProvider component
 */
interface AnthropicProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Anthropic provider configuration component
 */
export const AnthropicProvider = ({ showModelOptions, isPopup, currentMode }: AnthropicProviderProps) => {
	const { apiConfiguration, remoteConfigSettings } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange, handleModeFieldsChange } = useApiConfigurationHandlers()
	const modeFields = getModeSpecificFields(apiConfiguration, currentMode)
	const [validationError, setValidationError] = useState("")

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)
	const isAdaptiveThinkingModel = isClaudeOpusAdaptiveThinkingModel(selectedModelId)
	const adaptiveThinkingDefaultEffort =
		resolveClaudeOpusAdaptiveThinking(modeFields.reasoningEffort, modeFields.thinkingBudgetTokens).effort ??
		(selectedModelId === "claude-sonnet-5-5" && modeFields.reasoningEffort !== "none" ? "medium" : "none")

	// Helper function for model switching
	const handleModelChange = (modelId: string) => {
		const id = modelId.trim()
		if (id === selectedModelId || !id) return
		setValidationError("");
		handleModeFieldsChange(
			{
				apiModelId: { plan: "planModeApiModelId", act: "actModeApiModelId" },
				anthropicModelInfo: {
					plan: "planModeAnthropicModelInfo",
					act: "actModeAnthropicModelInfo",
				},
			},
			{ apiModelId: id, anthropicModelInfo: getAnthropicModelInfo(id) },
			currentMode,
		);
	};
	const updateModelInfo = (updates: Partial<ModelInfo>) =>
		handleModeFieldChange(
			{ plan: "planModeAnthropicModelInfo", act: "actModeAnthropicModelInfo" },
			{ ...selectedModelInfo, ...updates },
			currentMode,
		);
	const updateNumber = (
		field: "contextWindow" | "maxTokens" | "inputPrice" | "outputPrice",
		value: string,
	) => {
		if (value === (selectedModelInfo[field]?.toString() ?? "")) return
		const number = Number(value);
		const tokenLimit = field === "contextWindow" || field === "maxTokens";
		if (
			!value.trim() ||
			!Number.isFinite(number) ||
			number < 0 ||
			(tokenLimit && (!Number.isSafeInteger(number) || number === 0))
		) {
			setValidationError(
				tokenLimit
					? "Token limits must be positive whole numbers."
					: "Prices must be zero or greater.",
			);
			return;
		}
		setValidationError("");
		void updateModelInfo({ [field]: number });
	};


	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.apiKey || ""}
				onChange={(value) => {
					if (value !== (apiConfiguration?.apiKey || "")) void handleFieldChange("apiKey", value)
				}}
				providerName="Anthropic"
				signupUrl="https://console.anthropic.com/settings/keys"
			/>

			<RemotelyConfiguredInputWrapper hidden={remoteConfigSettings?.anthropicBaseUrl === undefined}>
				<BaseUrlField
					disabled={!!remoteConfigSettings?.anthropicBaseUrl}
					initialValue={apiConfiguration?.anthropicBaseUrl}
					label="Use custom base URL"
					onChange={(value) => {
						if (value !== apiConfiguration?.anthropicBaseUrl) void handleFieldChange("anthropicBaseUrl", value)
					}}
					placeholder="Default: https://api.anthropic.com"
					showLockIcon={!!remoteConfigSettings?.anthropicBaseUrl}
				/>
			</RemotelyConfiguredInputWrapper>

			{showModelOptions && (
				<>
					<ModelSelector
						label="Model"
						models={{ ...anthropicModels, [selectedModelId]: selectedModelInfo }}
						onChange={(e) => handleModelChange(e.target.value)}
						selectedModelId={selectedModelId}
					/>

					<DebouncedTextField
						className="w-full mt-2"
						initialValue={modeFields.apiModelId || selectedModelId}
						onChange={handleModelChange}
						placeholder="Exact model ID from your provider"
					>
						Custom model ID
					</DebouncedTextField>
					<ModelDiscovery
						apiKey={apiConfiguration?.apiKey}
						baseUrl={
							apiConfiguration?.anthropicBaseUrl || "https://api.anthropic.com"
						}
						onSelect={handleModelChange}
						protocol="anthropic"
						selectedModelId={selectedModelId}
					/>
					<details className="mt-3 mb-3">
						<summary className="cursor-pointer">
							Model limits and capabilities
						</summary>
						<p className="text-xs text-description">
							Applies to this mode. Model discovery does not confirm token
							limits or pricing; use your provider's values.
						</p>
						{(
							[
								["contextWindow", "Context window (tokens)"],
								["maxTokens", "Maximum output (tokens)"],
								["inputPrice", "Input price per million tokens"],
								["outputPrice", "Output price per million tokens"],
							] as const
						).map(([field, label]) => (
							<DebouncedTextField
								className="w-full mt-2"
								initialValue={selectedModelInfo[field]?.toString() ?? ""}
								key={`${currentMode}-${selectedModelId}-${field}`}
								onChange={(value) => updateNumber(field, value)}
							>
								{label}
							</DebouncedTextField>
						))}
						<div className="flex flex-col gap-2 mt-2">
							{(
								[
									["supportsImages", "Supports images"],
									["supportsPromptCache", "Supports prompt caching"],
									["supportsReasoning", "Supports budgeted thinking"],
								] as const
							).map(([field, label]) => (
								<VSCodeCheckbox
									checked={selectedModelInfo[field] ?? false}
									key={field}
									onChange={(event) =>
										updateModelInfo({
											[field]: (event.target as HTMLInputElement).checked,
										})
									}
								>
									{label}
								</VSCodeCheckbox>
							))}
							<label htmlFor="anthropic-native-tools">
								Native tool support
							</label>
							<select
								id="anthropic-native-tools"
								className="w-full bg-input-background text-input-foreground"
								value={
									selectedModelInfo.supportsTools === undefined
										? "auto"
										: String(selectedModelInfo.supportsTools)
								}
								onChange={(event) =>
									updateModelInfo({
										supportsTools:
											event.target.value === "auto"
												? undefined
												: event.target.value === "true",
									})
								}
							>
								<option value="auto">Detect from model name</option>
								<option value="true">
									Supported (requires Native Tool Call setting)
								</option>
								<option value="false">Unsupported</option>
							</select>
						</div>
						{validationError && (
							<p className="text-error text-xs" role="alert">
								{validationError}
							</p>
						)}
						<VSCodeButton
							appearance="secondary"
							className="mt-2"
							onClick={() => {
								setValidationError("");
								void handleModeFieldChange(
									{
										plan: "planModeAnthropicModelInfo",
										act: "actModeAnthropicModelInfo",
									},
									getAnthropicModelInfo(selectedModelId),
									currentMode,
								);
							}}
						>
							Reset model overrides
						</VSCodeButton>
					</details>

					{/* Context window switcher for Claude Sonnet 5 */}
					<ContextWindowSwitcher
						base1mModelId={`claude-sonnet-5${CLAUDE_SONNET_1M_SUFFIX}`}
						base200kModelId="claude-sonnet-5"
						onModelChange={handleModelChange}
						selectedModelId={selectedModelId}
					/>

					{/* Context window switcher for Claude Opus 4.6 */}
					<ContextWindowSwitcher
						base1mModelId={`claude-opus-4-6${CLAUDE_SONNET_1M_SUFFIX}`}
						base200kModelId="claude-opus-4-6"
						onModelChange={handleModelChange}
						selectedModelId={selectedModelId}
					/>

					<ContextWindowSwitcher
						base1mModelId={`claude-opus-4-6${CLAUDE_SONNET_1M_SUFFIX}${ANTHROPIC_FAST_MODE_SUFFIX}`}
						base200kModelId={`claude-opus-4-6${ANTHROPIC_FAST_MODE_SUFFIX}`}
						onModelChange={handleModelChange}
						selectedModelId={selectedModelId}
					/>

					{/* Context window switcher for Claude Sonnet 4.6 */}
					<ContextWindowSwitcher
						base1mModelId={`claude-sonnet-4-6${CLAUDE_SONNET_1M_SUFFIX}`}
						base200kModelId="claude-sonnet-4-6"
						onModelChange={handleModelChange}
						selectedModelId={selectedModelId}
					/>

					{/* Context window switcher for Claude Sonnet 4.5 */}
					<ContextWindowSwitcher
						base1mModelId={`claude-sonnet-4-5-20250929${CLAUDE_SONNET_1M_SUFFIX}`}
						base200kModelId="claude-sonnet-4-5-20250929"
						onModelChange={handleModelChange}
						selectedModelId={selectedModelId}
					/>

					{/* Context window switcher for Claude Sonnet 4 */}
					<ContextWindowSwitcher
						base1mModelId={`claude-sonnet-4-20250514${CLAUDE_SONNET_1M_SUFFIX}`}
						base200kModelId="claude-sonnet-4-20250514"
						onModelChange={handleModelChange}
						selectedModelId={selectedModelId}
					/>

					{isAdaptiveThinkingModel ? (
						<ReasoningEffortSelector
							allowedEfforts={["none", "low", "medium", "high", "xhigh"] as const}
							currentMode={currentMode}
							defaultEffort={adaptiveThinkingDefaultEffort}
							description={selectedModelId === "claude-sonnet-5-5" ? "None uses thinking between tool calls. Higher effort increases token usage." : "Use None to disable adaptive thinking. Higher effort increases response detail and token usage."}
							label="Adaptive Thinking"
						/>
					) : selectedModelInfo.supportsReasoning || SUPPORTED_ANTHROPIC_THINKING_MODELS.includes(selectedModelId) ? (
						<ThinkingBudgetSlider currentMode={currentMode} maxBudget={selectedModelInfo.thinkingConfig?.maxBudget} />
					) : null}

					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</>
			)}
		</div>
	)
}
