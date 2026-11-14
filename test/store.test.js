'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SessionStore, workspaceKey } = require('../src/store');
const { identifyTerminal, sessionIsRunning } = require('../src/identity');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'session-resume-store-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return new SessionStore(path.join(root, 'storage'));
}

test('two terminals in the same project get independent persistent identities and private files', t => {
  const store = fixture(t);
  const a = store.create({ name: 'API', cwd: os.tmpdir(), workspace: 'project-a' });
  const b = store.create({ name: 'Tests', cwd: os.tmpdir(), workspace: 'project-a' });
  assert.notEqual(a.id, b.id);
  assert.equal(store.list('project-a').length, 2);
  assert.equal(store.list('project-b').length, 0);
  const resumed = new SessionStore(store.root).get(a.id);
  assert.equal(resumed.name, 'API');
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(store.directory(a.id)).mode & 0o777, 0o700);
    assert.equal(fs.statSync(path.join(store.directory(a.id), 'history')).mode & 0o777, 0o600);
  }
});

test('saved cwd survives a fresh store and damaged metadata does not hide valid sessions', t => {
  const store = fixture(t);
  const a = store.create({ name: 'API', cwd: '/', workspace: 'project-a' });
  const b = store.create({ name: 'Tests', cwd: '/', workspace: 'project-a' });
  fs.writeFileSync(path.join(store.directory(a.id), 'cwd'), os.tmpdir());
  fs.writeFileSync(path.join(store.directory(b.id), 'session.json'), 'broken');
  assert.equal(new SessionStore(store.root).get(a.id).cwd, os.tmpdir());
  assert.deepEqual(store.list('project-a').map(session => session.id), [a.id]);
  assert.throws(() => store.get('../../etc/passwd'), /Invalid saved terminal ID/);
});

test('workspace scope is order independent and distinguishes remote hosts and worktrees', () => {
  assert.equal(workspaceKey(['file:///a', 'file:///b']), workspaceKey(['file:///b', 'file:///a']));
  assert.notEqual(workspaceKey(['file:///a']), workspaceKey(['file:///a-worktree']));
  assert.notEqual(workspaceKey(['vscode-remote://ssh-remote+one/a']), workspaceKey(['vscode-remote://ssh-remote+two/a']));
});

test('revived terminals are recognized after a rename, and stale PID reuse never selects old history', async t => {
  const store = fixture(t);
  const session = store.create({ name: 'API', cwd: os.tmpdir(), workspace: 'project-a' });
  fs.writeFileSync(path.join(store.directory(session.id), 'process'), '123\nold-process-birth');
  const terminal = { name: 'Renamed by the user', creationOptions: { name: 'Renamed by the user' }, processId: Promise.resolve(123) };
  assert.equal(await identifyTerminal(terminal, store, 'project-a', () => 'new-process-birth'), undefined);
  assert.equal(await identifyTerminal(terminal, store, 'project-a', () => 'old-process-birth'), session.id);
  assert.equal(await identifyTerminal(terminal, store, 'project-b', () => 'old-process-birth'), undefined);
});

test('publisher upgrade preserves legacy files and adopts the latest saved history only when resumed', t => {
  const original = fixture(t);
  const legacy = original.create({ name: 'API', cwd: os.tmpdir(), workspace: 'project-a' });
  original.update(legacy.id, { pinned: true });
  const source = path.join(original.directory(legacy.id), 'history');
  fs.writeFileSync(source, 'echo BEFORE_UPGRADE\n');
  const root = path.join(original.root, 'new-publisher');
  const upgraded = new SessionStore(root, { legacyRoot: original.root });
  assert.deepEqual(upgraded.imported, [legacy.id]);
  assert.equal(upgraded.get(legacy.id).pinned, true);
  assert.equal(upgraded.runtimeDirectory(legacy.id), original.directory(legacy.id));
  fs.appendFileSync(source, 'echo AFTER_IMPORT\n');
  fs.writeFileSync(path.join(original.directory(legacy.id), 'process'), '123\nlive-birth');
  assert.equal(sessionIsRunning(legacy.id, upgraded, () => 'live-birth'), true);
  assert.equal(sessionIsRunning(legacy.id, upgraded, () => 'different-birth'), false);
  upgraded.adoptLegacy(legacy.id);
  assert.equal(upgraded.runtimeDirectory(legacy.id), upgraded.directory(legacy.id));
  assert.equal(fs.readFileSync(path.join(upgraded.directory(legacy.id), 'history'), 'utf8'), 'echo BEFORE_UPGRADE\necho AFTER_IMPORT\n');
  assert.equal(fs.readFileSync(source, 'utf8'), 'echo BEFORE_UPGRADE\necho AFTER_IMPORT\n');
  upgraded.update(legacy.id, { name: 'Renamed in new publisher' });
  const restarted = new SessionStore(root, { legacyRoot: original.root });
  assert.deepEqual(restarted.imported, []);
  assert.equal(restarted.get(legacy.id).name, 'Renamed in new publisher');
  assert.equal(original.get(legacy.id).name, 'API');
});

test('a failed publisher import leaves no partial destination and retries without changing the original', t => {
  const original = fixture(t);
  const saved = original.create({ name: 'Tests', cwd: os.tmpdir(), workspace: 'project-a' });
  const source = path.join(original.directory(saved.id), 'history');
  fs.writeFileSync(source, 'npm test\n');
  const root = path.join(original.root, 'new-publisher');
  const copy = fs.copyFileSync;
  const failingCopy = t.mock.method(fs, 'copyFileSync', (...args) => {
    if (args[0] === source) throw new Error('Simulated interrupted copy');
    return copy(...args);
  });
  const failed = new SessionStore(root, { legacyRoot: original.root });
  assert.deepEqual(failed.imported, []);
  assert.equal(fs.existsSync(failed.directory(saved.id)), false);
  assert.deepEqual(fs.readdirSync(failed.sessions), []);
  failingCopy.mock.restore();
  const retried = new SessionStore(root, { legacyRoot: original.root });
  assert.deepEqual(retried.imported, [saved.id]);
  assert.equal(fs.readFileSync(source, 'utf8'), 'npm test\n');
});
