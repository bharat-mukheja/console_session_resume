'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath } = require('@vscode/test-electron');

async function main() {
  const executable = await downloadAndUnzipVSCode(process.env.VSCODE_VERSION || 'stable');
  const command = [executable, ...resolveCliArgsFromVSCodeExecutablePath(executable, { reuseMachineInstall: true })];
  const python = process.platform === 'win32' ? 'python' : 'python3';
  const result = spawnSync(python, [path.join(__dirname, 'test-vscode.py')], {
    stdio: 'inherit', env: { ...process.env, CSR_CODE_COMMAND: JSON.stringify(command), ELECTRON_RUN_AS_NODE: '1' }
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
