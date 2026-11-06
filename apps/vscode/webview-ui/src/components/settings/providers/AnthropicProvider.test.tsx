import type { ApiConfiguration } from "@shared/api"
import { getAnthropicModelInfo } from "@shared/api"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { ComponentProps, ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
	config: {} as ApiConfiguration,
	handleFieldChange: vi.fn(),
	handleModeFieldChange: vi.fn(),
	handleModeFieldsChange: vi.fn(),
}))
vi.mock("@/context/ExtensionStateContext", () => ({ useExtensionState: () => ({ apiConfiguration: mocks.config }) }))
vi.mock("../utils/useApiConfigurationHandlers", () => ({ useApiConfigurationHandlers: () => mocks }))
vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeTextField: ({ children, onInput, value }: ComponentProps<"input">) => <label>{children}<input onInput={onInput} value={value} readOnly /></label>,
	VSCodeCheckbox: ({ children, checked, onChange }: ComponentProps<"input">) => <label>{children}<input type="checkbox" checked={checked} onChange={onChange} /></label>,
	VSCodeButton: ({ children, onClick }: ComponentProps<"button">) => <button type="button" onClick={onClick}>{children}</button>,
}))
vi.mock("../common/ApiKeyField", () => ({ ApiKeyField: () => null }))
vi.mock("../common/BaseUrlField", () => ({ BaseUrlField: () => null }))
vi.mock("../common/ContextWindowSwitcher", () => ({ ContextWindowSwitcher: () => null }))
vi.mock("../common/ModelInfoView", () => ({ ModelInfoView: () => null }))
vi.mock("../common/ModelDiscovery", () => ({ ModelDiscovery: () => null }))
vi.mock("../common/RemotelyConfiguredInputWrapper", () => ({ RemotelyConfiguredInputWrapper: ({ children }: { children: ReactNode }) => children }))
vi.mock("../common/ModelSelector", () => ({ ModelSelector: ({ selectedModelId, onChange, models }: { selectedModelId: string; onChange: ComponentProps<"select">["onChange"]; models: Record<string, unknown> }) => (
	<select aria-label="Model" value={selectedModelId} onChange={onChange}>{Object.keys(models).map((id) => <option key={id}>{id}</option>)}</select>
) }))
vi.mock("../ReasoningEffortSelector", () => ({ default: () => null }))
vi.mock("../ThinkingBudgetSlider", () => ({ default: () => null }))

import { AnthropicProvider } from "./AnthropicProvider"

describe("AnthropicProvider model overrides", () => {
	beforeEach(() => {
		vi.useFakeTimers()
		vi.clearAllMocks()
		mocks.config = {
			actModeApiProvider: "anthropic", actModeApiModelId: "private/model",
			actModeAnthropicModelInfo: { supportsPromptCache: false, contextWindow: 1_000_000, maxTokens: 32_000, supportsTools: true },
			planModeApiProvider: "anthropic", planModeApiModelId: "plan/model",
			planModeAnthropicModelInfo: { supportsPromptCache: false, contextWindow: 256_000, maxTokens: 16_000, supportsTools: false },
		}
	})
	afterEach(() => { cleanup(); vi.useRealTimers() })
	const flush = () => act(() => vi.advanceTimersByTime(200))

	it("does not save or erase overrides on mount, including fields in collapsed details", () => {
		render(<AnthropicProvider currentMode="act" showModelOptions />)
		flush()
		expect(screen.getByLabelText("Context window (tokens)")).toHaveValue("1000000")
		expect(mocks.handleFieldChange).not.toHaveBeenCalled()
		expect(mocks.handleModeFieldChange).not.toHaveBeenCalled()
		expect(mocks.handleModeFieldsChange).not.toHaveBeenCalled()
		expect(screen.queryByRole("alert")).not.toBeInTheDocument()
	})

	it("switches modes without writing either mode's metadata", () => {
		const view = render(<AnthropicProvider currentMode="act" showModelOptions />)
		flush()
		view.rerender(<AnthropicProvider currentMode="plan" showModelOptions />)
		flush()
		expect(screen.getByLabelText("Context window (tokens)")).toHaveValue("256000")
		expect(screen.getByLabelText("Custom model ID")).toHaveValue("plan/model")
		expect(mocks.handleModeFieldChange).not.toHaveBeenCalled()
		expect(mocks.handleModeFieldsChange).not.toHaveBeenCalled()
	})

	it("changes an ID atomically with explicit defaults, so storage cannot retain old limits", () => {
		render(<AnthropicProvider currentMode="act" showModelOptions />)
		flush()
		fireEvent.input(screen.getByLabelText("Custom model ID"), { target: { value: "other/model" } })
		flush()
		expect(mocks.handleModeFieldsChange).toHaveBeenCalledExactlyOnceWith(
			expect.any(Object), { apiModelId: "other/model", anthropicModelInfo: getAnthropicModelInfo("other/model") }, "act",
		)
	})

	it("resets overrides with a complete default object rather than undefined", () => {
		render(<AnthropicProvider currentMode="act" showModelOptions />)
		flush()
		fireEvent.click(screen.getByText("Reset model overrides"))
		expect(mocks.handleModeFieldChange).toHaveBeenCalledExactlyOnceWith(
			{ plan: "planModeAnthropicModelInfo", act: "actModeAnthropicModelInfo" }, getAnthropicModelInfo("private/model"), "act",
		)
	})

	it("saves only an edited valid number and keeps the other capabilities", () => {
		render(<AnthropicProvider currentMode="act" showModelOptions />)
		flush()
		fireEvent.input(screen.getByLabelText("Context window (tokens)"), { target: { value: "NaN" } })
		flush()
		expect(mocks.handleModeFieldChange).not.toHaveBeenCalled()
		fireEvent.input(screen.getByLabelText("Context window (tokens)"), { target: { value: "500000" } })
		flush()
		expect(mocks.handleModeFieldChange).toHaveBeenCalledExactlyOnceWith(
			expect.any(Object), expect.objectContaining({ contextWindow: 500_000, maxTokens: 32_000, supportsTools: true }), "act",
		)
	})
})
