'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { downloadAndUnzipVSCode } = require('@vscode/test-electron');

async function main() {
  const executable = await downloadAndUnzipVSCode(process.env.VSCODE_VERSION || 'stable');
  // Run the actual JS CLI through Electron's Node mode, not the bin/code shell wrapper.
  const cli = process.platform === 'darwin'
    ? path.resolve(path.dirname(executable), '../Resources/app/out/cli.js')
    : path.join(path.dirname(executable), 'resources', 'app', 'out', 'cli.js');
  if (!fs.existsSync(cli)) throw new Error(`VS Code CLI entry point not found: ${cli}`);
  const command = [executable, cli];
  const python = process.platform === 'win32' ? 'python' : 'python3';
  const result = spawnSync(python, [path.join(__dirname, 'test-vscode.py')], {
    stdio: 'inherit', env: { ...process.env, CSR_CODE_COMMAND: JSON.stringify(command), ELECTRON_RUN_AS_NODE: '1' }
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
