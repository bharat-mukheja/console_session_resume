'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath } = require('@vscode/test-electron');

async function main() {
  const executable = await downloadAndUnzipVSCode(process.env.VSCODE_VERSION || 'stable');
  // Use the vendor's wrapper so each platform/version supplies its own CLI layout.
  const cli = resolveCliArgsFromVSCodeExecutablePath(executable, { reuseMachineInstall: true });
  const command = process.platform === 'win32' ? [process.env.ComSpec || 'cmd.exe', '/d', '/s', '/c', ...cli] : cli;
  const python = process.platform === 'win32' ? 'python' : 'python3';
  const result = spawnSync(python, [path.join(__dirname, 'test-vscode.py')], {
    stdio: 'inherit', env: { ...process.env, CSR_CODE_COMMAND: JSON.stringify(command) }
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
