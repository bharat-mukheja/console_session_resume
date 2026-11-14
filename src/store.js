'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

function workspaceKey(uris) {
  return crypto.createHash('sha256').update(JSON.stringify([...uris].sort())).digest('hex');
}

class SessionStore {
  constructor(root, { legacyRoot } = {}) {
    this.root = root;
    this.legacyRoot = legacyRoot;
    this.sessions = path.join(root, 'sessions');
    fs.mkdirSync(this.sessions, { recursive: true, mode: 0o700 });
    fs.chmodSync(root, 0o700);
    fs.chmodSync(this.sessions, 0o700);
    this.imported = this.importLegacy();
  }

  directory(id) {
    if (!ID_PATTERN.test(id)) throw new Error('Invalid saved terminal ID.');
    return path.join(this.sessions, id);
  }

  runtimeDirectory(id) {
    const directory = this.directory(id);
    if (this.legacyRoot) {
      const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'session.json'), 'utf8'));
      const legacy = path.join(this.legacyRoot, 'sessions', id);
      if (metadata.legacyStorage && fs.existsSync(legacy) && fs.lstatSync(legacy).isDirectory()) return legacy;
    }
    return directory;
  }

  importLegacy() {
    const imported = [];
    const source = this.legacyRoot && path.join(this.legacyRoot, 'sessions');
    if (!source || !fs.existsSync(source) || path.resolve(this.legacyRoot) === path.resolve(this.root)) return imported;
    for (const id of fs.readdirSync(source)) {
      if (!ID_PATTERN.test(id) || fs.existsSync(this.directory(id))) continue;
      const legacy = path.join(source, id);
      let staging;
      try {
        if (!fs.lstatSync(legacy).isDirectory()) continue;
        const metadata = JSON.parse(fs.readFileSync(path.join(legacy, 'session.json'), 'utf8'));
        if (metadata.id !== id || typeof metadata.workspace !== 'string' || typeof metadata.name !== 'string'
          || typeof metadata.cwd !== 'string') continue;
        staging = fs.mkdtempSync(path.join(this.sessions, '.import-'));
        fs.chmodSync(staging, 0o700);
        for (const name of ['history', 'cwd']) {
          const file = path.join(legacy, name);
          const destination = path.join(staging, name);
          if (fs.existsSync(file) && fs.lstatSync(file).isFile()) fs.copyFileSync(file, destination, fs.constants.COPYFILE_EXCL);
          else fs.writeFileSync(destination, name === 'cwd' ? metadata.cwd : '', { mode: 0o600, flag: 'wx' });
          fs.chmodSync(destination, 0o600);
        }
        fs.writeFileSync(path.join(staging, 'session.json'), JSON.stringify({ ...metadata, legacyStorage: true }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
        fs.renameSync(staging, this.directory(id));
        staging = undefined;
        imported.push(id);
      } catch { /* Preserve the original and continue with other readable sessions. */ }
      finally { if (staging) fs.rmSync(staging, { recursive: true, force: true }); }
    }
    return imported;
  }

  adoptLegacy(id) {
    const directory = this.directory(id);
    const source = this.runtimeDirectory(id);
    if (source === directory) return;
    // Called only after checking for a live writer. Keep the originals intact.
    for (const name of ['history', 'cwd']) {
      const original = path.join(source, name);
      if (!fs.existsSync(original)) continue;
      const temporary = path.join(directory, `${name}.${crypto.randomUUID()}.tmp`);
      fs.copyFileSync(original, temporary, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(temporary, 0o600);
      fs.renameSync(temporary, path.join(directory, name));
    }
    const file = path.join(directory, 'session.json');
    const metadata = JSON.parse(fs.readFileSync(file, 'utf8'));
    metadata.legacyStorage = false;
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(metadata, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(temporary, file);
  }

  create({ name, cwd, workspace, shell = 'bash' }) {
    const session = { id: crypto.randomUUID(), name, cwd, workspace, shell, createdAt: new Date().toISOString() };
    const directory = this.directory(session.id);
    fs.mkdirSync(directory, { mode: 0o700 });
    fs.writeFileSync(path.join(directory, 'history'), '', { mode: 0o600, flag: 'wx' });
    fs.writeFileSync(path.join(directory, 'cwd'), cwd, { mode: 0o600, flag: 'wx' });
    fs.writeFileSync(path.join(directory, 'session.json'), JSON.stringify(session, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    return session;
  }

  get(id) {
    const directory = this.directory(id);
    const data = JSON.parse(fs.readFileSync(path.join(directory, 'session.json'), 'utf8'));
    if (data.id !== id || typeof data.workspace !== 'string' || typeof data.name !== 'string' || typeof data.cwd !== 'string') {
      throw new Error('Invalid saved terminal metadata.');
    }
    try {
      const cwd = fs.readFileSync(path.join(this.runtimeDirectory(id), 'cwd'), 'utf8');
      if (path.isAbsolute(cwd) && fs.statSync(cwd).isDirectory()) data.cwd = cwd;
    } catch { /* Keep the initial cwd if the latest directory no longer exists. */ }
    return data;
  }

  update(id, changes) {
    const file = path.join(this.directory(id), 'session.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (changes.name !== undefined) {
      const name = String(changes.name).trim();
      if (!name || name.length > 120 || /[\x00-\x1f\x7f]/.test(name)) throw new Error('Use a name of 1–120 characters on one line.');
      data.name = name;
    }
    if (changes.pinned !== undefined) data.pinned = Boolean(changes.pinned);
    if (changes.lastUsedAt !== undefined) data.lastUsedAt = changes.lastUsedAt;
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(temporary, file);
    return this.get(id);
  }

  list(workspace) {
    const result = [];
    for (const id of fs.readdirSync(this.sessions)) {
      if (!ID_PATTERN.test(id)) continue;
      try {
        const session = this.get(id);
        if (session.workspace === workspace) {
          session.updatedAt = Math.max(fs.statSync(path.join(this.runtimeDirectory(id), 'history')).mtimeMs,
            fs.statSync(path.join(this.runtimeDirectory(id), 'cwd')).mtimeMs, Date.parse(session.lastUsedAt || '') || 0);
          result.push(session);
        }
      } catch { /* A damaged session must not hide the other recoverable sessions. */ }
    }
    return result.sort((a, b) => b.updatedAt - a.updatedAt);
  }
}

module.exports = { SessionStore, workspaceKey };
