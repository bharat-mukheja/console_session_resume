'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createController } = require('../src/extension');

const { fixture } = require('./support');

test('profiles persist their identity in launch options, with no settings changed at activation', async t => {
  const { context, vscode, providers, updates } = fixture(t);
  const api = createController(context, vscode);
  const a = await providers.get('sessionResume.bash').provideTerminalProfile();
  const b = await providers.get('sessionResume.bash').provideTerminalProfile();
  assert.notEqual(a.options.env.CSR_SESSION_ID, b.options.env.CSR_SESSION_ID);
  assert.notEqual(a.options.env.HISTFILE, b.options.env.HISTFILE);
  assert.match(a.options.name, / · Bash 1$/);
  assert.match(b.options.name, / · Bash 2$/);
  assert.equal(a.options.isTransient, false);
  assert.deepEqual(updates, []);
  const stable = a.options.shellArgs[1];
  assert.ok(stable.startsWith(context.globalStorageUri.fsPath));
  assert.ok(fs.existsSync(stable));
  assert.equal(api.store.list(api.workspace).length, 2);
});

test('resume focuses an existing terminal, then recreates the same session after termination', async t => {
  const { context, vscode, root } = fixture(t);
  const api = createController(context, vscode);
  const first = await api.newTerminal({ name: 'API', cwd: root });
  const id = first.creationOptions.env.CSR_SESSION_ID;
  assert.equal(await api.resumeTerminal(id), first);
  assert.equal(vscode.window.terminals.length, 1);
  vscode.window.terminals.length = 0;
  const afterRestart = createController(context, vscode);
  const resumed = await afterRestart.resumeTerminal(id);
  assert.equal(resumed.creationOptions.env.HISTFILE, first.creationOptions.env.HISTFILE);
  assert.equal(resumed.creationOptions.env.CSR_SESSION_ID, id);
  assert.equal(resumed.creationOptions.name, 'API');
});

test('resuming another workspace is rejected, and selecting the default enables window-close revival', async t => {
  const { context, vscode, commands, updates, root } = fixture(t);
  const api = createController(context, vscode);
  const other = api.store.create({ name: 'Other', cwd: root, workspace: 'another-workspace' });
  await assert.rejects(() => api.resumeTerminal(other.id), /another workspace/);
  await commands.get('sessionResume.useAsDefault')();
  assert.ok(updates.some(([key, value]) => key === 'persistentSessionReviveProcess' && value === 'onExitAndWindowClose'));
});
