import { OpenAiModelsRequest } from "@shared/proto/cline/models"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useEffect, useRef, useState } from "react"
import { ModelsServiceClient } from "@/services/grpc-client"

interface ModelDiscoveryProps {
	baseUrl?: string
	apiKey?: string
	headers?: Record<string, string>
	protocol?: "openai" | "anthropic"
	selectedModelId?: string
	onSelect: (modelId: string) => void
	disabled?: boolean
}

/** Model IDs are discovered on demand; discovery never changes model limits or credentials. */
export const ModelDiscovery = ({
	baseUrl,
	apiKey,
	headers,
	protocol = "openai",
	selectedModelId,
	onSelect,
	disabled = false,
}: ModelDiscoveryProps) => {
	const [models, setModels] = useState<string[]>([])
	const [loading, setLoading] = useState(false)
	const [loaded, setLoaded] = useState(false)
	const [error, setError] = useState("")
	const requestVersion = useRef(0)
	const headersKey = JSON.stringify(headers ?? {})

	// Switching endpoints/keys/groups invalidates a list. It never starts a request.
	// biome-ignore lint/correctness/useExhaustiveDependencies: These inputs identify the request whose result must be invalidated.
	useEffect(() => {
		requestVersion.current++
		setModels([])
		setLoaded(false)
		setLoading(false)
		setError("")
		return () => {
			requestVersion.current++
		}
	}, [baseUrl, apiKey, protocol, headersKey])

	const refresh = async () => {
		const version = ++requestVersion.current
		setLoading(true)
		setError("")
		setLoaded(false)
		setModels([])
		try {
			const result = await ModelsServiceClient.refreshOpenAiModels(
				OpenAiModelsRequest.create({ baseUrl: baseUrl ?? "", apiKey: apiKey ?? "", headers: headers ?? {}, protocol }),
			)
			if (version !== requestVersion.current) return
			setModels(result.values)
			setLoaded(true)
		} catch (cause) {
			if (version !== requestVersion.current) return
			// The host only forwards locally generated, credential-free discovery errors.
			// Do not display unrelated transport errors or log request objects.
			const message = cause instanceof Error ? cause.message : ""
			setError(
				message.startsWith("Model discovery:")
					? message
					: "Unable to fetch models. Check the extension host connection and try again.",
			)
		} finally {
			if (version === requestVersion.current) setLoading(false)
		}
	}

	return (
		<div style={{ marginBottom: 10 }}>
			<VSCodeButton appearance="secondary" disabled={disabled || loading || !baseUrl?.trim()} onClick={refresh}>
				{loading ? "Fetching models…" : "Get model list"}
			</VSCodeButton>
			<p style={{ fontSize: 12, margin: "6px 0", color: "var(--vscode-descriptionForeground)" }}>
				Fetches from the extension host. With Remote SSH, the request runs on the remote machine. You can always enter a
				Model ID manually.
			</p>
			{error && (
				<p role="alert" style={{ fontSize: 12, color: "var(--vscode-errorForeground)" }}>
					{error}
				</p>
			)}
			{loaded && models.length === 0 && (
				<output style={{ display: "block", fontSize: 12 }}>
					The endpoint returned no models for this token or group. You can enter a Model ID manually.
				</output>
			)}
			{models.length > 0 && (
				<label style={{ display: "block", fontSize: 12 }}>
					Available models ({models.length})
					<select
						aria-label="Available models"
						disabled={disabled || loading}
						onChange={(event) => {
							if (event.target.value) onSelect(event.target.value)
						}}
						style={{
							width: "100%",
							marginTop: 4,
							padding: 5,
							color: "var(--vscode-dropdown-foreground)",
							background: "var(--vscode-dropdown-background)",
							border: "1px solid var(--vscode-dropdown-border)",
						}}
						value={selectedModelId && models.includes(selectedModelId) ? selectedModelId : ""}>
						<option value="">Select a model…</option>
						{models.map((model) => (
							<option key={model} value={model}>
								{model}
							</option>
						))}
					</select>
				</label>
			)}
		</div>
	)
}
