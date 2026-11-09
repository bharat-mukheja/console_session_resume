'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createController } = require('../src/extension');
const { parseHistory, HistoryPreview } = require('../src/history');
const { quickPickItems, relativeTime } = require('../src/resume-ui');
const { fixture } = require('./support');

test('command previews understand each native history format without timestamps or Fish metadata', () => {
  assert.deepEqual(parseHistory('#123\nnpm run dev\n#124\nfor n in one two; do\n echo "$n"\ndone\n', 'bash'),
    ['npm run dev', 'for n in one two; do\n echo "$n"\ndone']);
  assert.deepEqual(parseHistory(': 123:0;git status\n: 124:1;npm test\n', 'zsh'), ['git status', 'npm test']);
  assert.deepEqual(parseHistory('Get-Process\nWrite-Output `\nhello\n', 'pwsh'), ['Get-Process', 'Write-Output \nhello']);
  assert.deepEqual(parseHistory('- cmd: echo one\\necho two\n  when: 123\n  paths:\n    - /tmp\n- cmd: git status\n', 'fish'),
    ['echo one\necho two', 'git status']);
});

test('previews follow atomic history replacement, stay bounded, and tolerate missing files', t => {
  const { root } = fixture(t);
  const history = path.join(root, 'history');
  fs.writeFileSync(history, 'x'.repeat(70000) + '\n#123\nFIRST\n');
  const reader = new HistoryPreview();
  assert.deepEqual(reader.read(history, 'bash'), ['FIRST']);
  fs.writeFileSync(history + '.tmp', '#124\nOTHER\n');
  fs.renameSync(history + '.tmp', history);
  assert.deepEqual(reader.read(history, 'bash'), ['OTHER']);
  assert.deepEqual(reader.read(history + '.missing', 'bash'), []);
});

test('resume search shows pinned, open and saved sessions with useful context and cancellation creates nothing', async t => {
  const { context, vscode, quickPicks, root } = fixture(t);
  const api = createController(context, vscode);
  const open = await api.newTerminal({ name: 'API server', cwd: root, shell: 'bash' });
  const saved = api.store.create({ name: 'Database migrations', cwd: root, workspace: api.workspace, shell: 'bash' });
  const pinned = api.store.create({ name: 'Tests', cwd: root, workspace: api.workspace, shell: 'pwsh' });
  api.store.update(pinned.id, { pinned: true });
  fs.writeFileSync(path.join(api.store.directory(saved.id), 'history'), '#123\npython migrate.py\n');
  const sessions = await api.listSessions();
  const items = quickPickItems(sessions, vscode);
  assert.deepEqual(items.filter(item => item.kind === -1).map(item => item.label), ['Pinned', 'Open', 'Saved']);
  assert.ok(items.find(item => item.session?.id === saved.id).detail.includes('python migrate.py'));
  assert.ok(!items.find(item => item.session?.id === saved.id).description.includes(saved.id.slice(0, 8)));
  const result = api.resumeTerminal();
  await new Promise(resolve => setImmediate(resolve));
  const picker = quickPicks.at(-1);
  assert.equal(picker.matchOnDetail, true);
  assert.equal(picker.matchOnDescription, true);
  picker.hide();
  await result;
  assert.equal(vscode.window.terminals.length, 1);
  assert.equal(vscode.window.terminals[0], open);
});

test('selecting an open session focuses it and concurrent resume clicks do not duplicate writers', async t => {
  const { context, vscode, quickPicks, root } = fixture(t);
  const api = createController(context, vscode);
  const open = await api.newTerminal({ name: 'API', shell: 'bash', cwd: root });
  const result = api.resumeTerminal();
  await new Promise(resolve => setImmediate(resolve));
  const picker = quickPicks.at(-1);
  picker.selectedItems = [picker.items.find(item => item.session?.terminal === open)];
  picker.accept();
  assert.equal(await result, open);
  const saved = api.store.create({ name: 'Tests', shell: 'bash', cwd: root, workspace: api.workspace });
  const [a, b] = await Promise.all([api.resumeTerminal(saved.id), api.resumeTerminal(saved.id)]);
  assert.equal(a, b);
  assert.equal(vscode.window.terminals.length, 2);
});

test('rename and pin persist across reload, preview leaves history unchanged, and split uses a native pane', async t => {
  const { context, vscode, root } = fixture(t);
  const api = createController(context, vscode);
  const open = await api.newTerminal({ name: 'Bash', shell: 'bash', cwd: root });
  const id = open.creationOptions.env.CSR_SESSION_ID;
  await api.renameSession(id, 'Backend API');
  await api.pinSession(id);
  assert.equal(open.name, 'Backend API');
  assert.equal(api.store.get(id).name, 'Backend API');
  const file = path.join(api.store.directory(id), 'history');
  fs.writeFileSync(file, '#123\nnpm run dev\n');
  await api.previewHistory(id);
  assert.ok(vscode.document.getText().includes('npm run dev'));
  assert.equal(fs.readFileSync(file, 'utf8'), '#123\nnpm run dev\n');
  const saved = api.store.create({ name: 'Tests', cwd: root, shell: 'bash', workspace: api.workspace });
  const split = await api.resumeTerminal(saved.id, { split: true });
  assert.equal(split.creationOptions.location.parentTerminal, open);
  api.store.create({ name: 'Database', cwd: root, shell: 'bash', workspace: api.workspace });
  assert.equal(await api.resumeAll(), 1);
  assert.equal(vscode.window.terminals.length, 3);
  assert.equal(await api.resumeAll(), 0);
  const afterRestart = createController(context, vscode);
  assert.equal(afterRestart.store.get(id).pinned, true);
  assert.equal(afterRestart.store.get(id).name, 'Backend API');
  await afterRestart.sessionsView.refresh();
  const groups = afterRestart.sessionsView.provider.getChildren();
  assert.equal(groups[0].label, 'Pinned');
  assert.equal(afterRestart.sessionsView.status.visible, true);
});

test('pinning from the picker keeps the search text and promotes the saved session', async t => {
  const { context, vscode, quickPicks, root } = fixture(t);
  const api = createController(context, vscode);
  const saved = api.store.create({ name: 'Test suite', shell: 'bash', cwd: root, workspace: api.workspace });
  const picking = api.resumeTerminal();
  await new Promise(resolve => setImmediate(resolve));
  const first = quickPicks.at(-1);
  first.value = 'Test suite';
  const item = first.items.find(option => option.session?.id === saved.id);
  first.pressButton({ item, button: item.buttons.find(button => button.action === 'pin') });
  await new Promise(resolve => setImmediate(resolve));
  const next = quickPicks.at(-1);
  assert.notEqual(next, first);
  assert.equal(next.value, 'Test suite');
  assert.equal(next.items[0].label, 'Pinned');
  assert.equal(api.store.get(saved.id).pinned, true);
  assert.equal(vscode.window.terminals.length, 0);
  next.hide();
  await picking;
});

test('relative time describes future clock drift and recent sessions clearly', () => {
  assert.equal(relativeTime(100000, 90000), 'just now');
  assert.equal(relativeTime(0, 2 * 60000), '2m ago');
  assert.equal(relativeTime(0, 25 * 60 * 60000), 'yesterday');
});
