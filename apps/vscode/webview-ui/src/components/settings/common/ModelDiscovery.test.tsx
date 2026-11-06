import { act, fireEvent, render, screen } from "@testing-library/react"
import type { ButtonHTMLAttributes } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ModelDiscovery } from "./ModelDiscovery"

const { refreshModels } = vi.hoisted(() => ({ refreshModels: vi.fn() }))
vi.mock("@/services/grpc-client", () => ({ ModelsServiceClient: { refreshOpenAiModels: refreshModels } }))
vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeButton: ({ appearance: _appearance, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { appearance?: string }) => (
		<button {...props} />
	),
}))

describe("ModelDiscovery", () => {
	beforeEach(() => {
		refreshModels.mockReset()
	})

	it("only requests on click and passes headers; selecting a result leaves metadata to its caller", async () => {
		refreshModels.mockResolvedValue({ values: ["first", "second"] })
		const select = vi.fn()
		const { rerender } = render(<ModelDiscovery apiKey="key-a" baseUrl="https://gateway.example/v1" onSelect={select} />)
		rerender(
			<ModelDiscovery apiKey="key-b" baseUrl="https://gateway.example/v1" headers={{ "X-Group": "b" }} onSelect={select} />,
		)
		expect(refreshModels).not.toHaveBeenCalled()
		fireEvent.click(screen.getByRole("button", { name: "Get model list" }))
		await screen.findByRole("combobox", { name: "Available models" })
		expect(refreshModels).toHaveBeenCalledWith(
			expect.objectContaining({ apiKey: "key-b", headers: { "X-Group": "b" }, protocol: "openai" }),
		)
		expect(select).not.toHaveBeenCalled()
		fireEvent.change(screen.getByRole("combobox"), { target: { value: "second" } })
		expect(select).toHaveBeenCalledWith("second")
	})

	it("distinguishes successful empty results from failures and allows retries", async () => {
		refreshModels
			.mockResolvedValueOnce({ values: [] })
			.mockRejectedValueOnce(new Error("Model discovery: HTTP 403. Check the API key."))
		render(<ModelDiscovery baseUrl="https://gateway.example/v1" onSelect={vi.fn()} />)
		fireEvent.click(screen.getByRole("button", { name: "Get model list" }))
		expect(await screen.findByRole("status")).toHaveTextContent("returned no models")
		fireEvent.click(screen.getByRole("button", { name: "Get model list" }))
		expect(await screen.findByRole("alert")).toHaveTextContent("HTTP 403")
		expect(screen.queryByRole("status")).not.toBeInTheDocument()
	})

	it("ignores stale responses after switching endpoint or token", async () => {
		let resolve: (value: { values: string[] }) => void = () => {}
		refreshModels.mockReturnValue(
			new Promise((done) => {
				resolve = done
			}),
		)
		const { rerender } = render(<ModelDiscovery apiKey="old-key" baseUrl="https://gateway.example/v1" onSelect={vi.fn()} />)
		fireEvent.click(screen.getByRole("button", { name: "Get model list" }))
		expect(screen.getByRole("button", { name: "Fetching models…" })).toBeDisabled()
		rerender(<ModelDiscovery apiKey="new-key" baseUrl="https://gateway.example/v1" onSelect={vi.fn()} />)
		await act(async () => resolve({ values: ["old-group-model"] }))
		expect(screen.queryByRole("combobox")).not.toBeInTheDocument()
		expect(refreshModels).toHaveBeenCalledTimes(1)
	})

	it("hides unrelated transport errors that could include secrets", async () => {
		refreshModels.mockRejectedValue(new Error("transport failed with secret-token"))
		render(<ModelDiscovery baseUrl="https://gateway.example/v1" onSelect={vi.fn()} />)
		fireEvent.click(screen.getByRole("button", { name: "Get model list" }))
		expect(await screen.findByRole("alert")).toHaveTextContent("Unable to fetch models")
		expect(screen.queryByText(/secret-token/)).not.toBeInTheDocument()
	})
})
