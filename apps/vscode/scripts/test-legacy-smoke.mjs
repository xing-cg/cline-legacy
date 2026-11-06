import { mkdir, mkdtemp } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { fileURLToPath } from "node:url"
import { runTests } from "@vscode/test-electron"

const extensionDevelopmentPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const isolated = await mkdtemp(path.join(os.tmpdir(), "cline-legacy-smoke-"))
const workspace = path.join(isolated, "workspace")
await mkdir(workspace)
// createStorageContext() uses CLINE_DIR independently of VS Code's user-data-dir.
// Override it only in the test child so settings and active API keys cannot be
// read from or migrated into the user's ~/.cline/data directory.
await runTests({
	version: "1.95.3",
	extensionDevelopmentPath,
	extensionTestsPath: path.join(extensionDevelopmentPath, "src/hosts/vscode/legacy/legacy-smoke.cjs"),
	extensionTestsEnv: { CLINE_DIR: path.join(isolated, "cline") },
	launchArgs: [
		workspace,
		"--user-data-dir", path.join(isolated, "user"),
		"--extensions-dir", path.join(isolated, "extensions"),
		"--disable-extensions", "--skip-welcome", "--skip-release-notes",
	],
})
