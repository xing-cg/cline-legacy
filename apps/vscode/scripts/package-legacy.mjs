// Package already-checked output without rerunning the upstream release pipeline.
// vsce is pinned by package-lock.json; pack retains its manifest and secret checks.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile, access, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { pack } from "@vscode/vsce/out/package.js"

const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const manifest = JSON.parse(await readFile(path.join(cwd, "package.json"), "utf8"))
assert.equal(manifest.version, "4.0.12", "The legacy extension version must stay pinned")
assert.equal(manifest.engines.vscode, "^1.84.0", "Do not raise or bypass the legacy VS Code requirement")
assert.ok(manifest.contributes.commands.some((entry) => entry.command === "cline.legacyConnections"))
for (const file of ["dist/extension.js", "webview-ui/build/assets/index.js"]) await access(path.join(cwd, file))
const packagePath = path.resolve(process.argv[2] || path.join(cwd, "dist/cline-4.0.12-intranet.vsix"))
await mkdir(path.dirname(packagePath), { recursive: true })
await pack({ cwd, packagePath, dependencies: false, useYarn: false })
const sha256 = createHash("sha256").update(await readFile(packagePath)).digest("hex")
await writeFile(`${packagePath}.sha256`, `${sha256}  ${path.basename(packagePath)}\n`, "utf8")
console.log(`Packaged ${path.basename(packagePath)}; SHA-256 ${sha256}`)
