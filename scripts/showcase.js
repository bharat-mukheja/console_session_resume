'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const base = path.join(root, '.test-work', 'showcase');
const project = path.join(base, 'orbit-api');
const user = path.join(base, 'user');
const extensions = path.join(base, 'extensions');
const harness = path.join(base, 'harness');
for (const directory of [project, path.join(user, 'User'), harness]) fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'orbit-api', version: '1.0.0', private: true,
  scripts: { dev: 'node app.js', test: 'node --test sample.test.js', 'db:migrate': 'node migrate.js' } }, null, 2));
fs.writeFileSync(path.join(project, 'app.js'), "console.log('Orbit API development environment ready.');\n");
fs.writeFileSync(path.join(project, 'migrate.js'), "console.log('Database schema is up to date. No pending migrations.');\n");
fs.writeFileSync(path.join(project, 'sample.test.js'), "const test=require('node:test');const assert=require('node:assert/strict');\ntest('health endpoint returns OK',()=>assert.equal('OK','OK'));\ntest('project identifier is normalized',()=>assert.equal('Orbit API'.toLowerCase().replaceAll(' ','-'),'orbit-api'));\n");
fs.writeFileSync(path.join(project, 'README.md'), '# Orbit API\n\nDevelopment workspace\n\nAPI server       npm run dev\nTest suite       npm test\nDatabase         npm run db:migrate\n\nEach terminal keeps its own command history.\nResume a saved terminal from the status bar or Saved Terminals.\n');
const settings = { 'workbench.colorTheme': 'Default Dark Modern', 'workbench.startupEditor': 'none',
  'telemetry.telemetryLevel': 'off', 'update.mode': 'none', 'security.workspace.trust.enabled': false,
  'git.enabled': false, 'editor.fontSize': 15, 'terminal.integrated.fontSize': 14,
  'terminal.integrated.tabs.enabled': true, 'terminal.integrated.tabs.hideCondition': 'never',
  'terminal.integrated.confirmOnExit': 'never', 'terminal.integrated.confirmOnKill': 'never',
  'window.commandCenter': false, 'workbench.editor.enablePreview': false };
fs.writeFileSync(path.join(user, 'User', 'settings.json'), JSON.stringify(settings));
fs.writeFileSync(path.join(harness, 'package.json'), JSON.stringify({ name: 'session-resume-showcase', publisher: 'local-tests',
  version: '0.0.2', description: 'Isolated screenshot fixture', license: 'UNLICENSED', engines: { vscode: '^1.93.0' }, main: './extension.js', activationEvents: ['onStartupFinished'] }));
fs.writeFileSync(path.join(harness, 'extension.js'), `exports.activate=()=>require(${JSON.stringify(path.join(root, 'test', 'showcase'))}).run();\n`);
fs.writeFileSync(path.join(harness, 'README.md'), '# Screenshot fixture\n\nLocal development only.\n');
const manifest = require('../package.json');
const code = process.env.CSR_CODE_CLI || 'code';
const args = process.env.CSR_SHOWCASE_NAMED_PROFILE
  ? ['--profile', 'Session Resume Screenshots'] : ['--user-data-dir', user, '--extensions-dir', extensions];
let result = spawnSync(code, [...args, '--install-extension', path.join(root, 'dist', `${manifest.name}-${manifest.version}.vsix`), '--force'], { stdio: 'inherit' });
if (result.status) process.exit(result.status);
const fixture = path.join(base, 'showcase.vsix');
result = spawnSync(process.execPath, [path.join(root, 'node_modules', '@vscode', 'vsce', 'vsce'), 'package', '--no-dependencies', '--allow-missing-repository', '--skip-license', '--out', fixture], { cwd: harness, stdio: 'inherit' });
if (result.status) process.exit(result.status);
result = spawnSync(code, [...args, '--install-extension', fixture, '--force'], { stdio: 'inherit' });
if (result.status) process.exit(result.status);
result = spawnSync(code, [...args, '--new-window', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', project], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
console.log(`Showcase state: ${path.join(base, 'state.json')}`);
