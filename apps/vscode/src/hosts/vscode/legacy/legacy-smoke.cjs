const assert = require("node:assert/strict")
const vscode = require("vscode")

exports.run = async () => {
	assert.equal(vscode.version, "1.95.3")
	const extension = vscode.extensions.getExtension("saoudrizwan.claude-dev")
	assert.ok(extension, "Legacy extension must be discovered")
	assert.equal(extension.packageJSON.version, "4.0.12")
	await extension.activate()
	assert.ok(extension.isActive, "Legacy extension must activate on the target VS Code runtime")
	const commands = await vscode.commands.getCommands(true)
	assert.ok(commands.includes("cline.legacyConnections"), "Connection UI command must be registered")
	await vscode.commands.executeCommand("cline.legacyConnections")
	await vscode.commands.executeCommand("workbench.action.closeActiveEditor")
	process.stdout.write("Legacy VS Code 1.95.3 activation and command smoke test passed\n")
}
