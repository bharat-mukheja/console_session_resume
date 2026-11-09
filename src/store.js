'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

function workspaceKey(uris) {
  return crypto.createHash('sha256').update(JSON.stringify([...uris].sort())).digest('hex');
}

class SessionStore {
  constructor(root) {
    this.root = root;
    this.sessions = path.join(root, 'sessions');
    fs.mkdirSync(this.sessions, { recursive: true, mode: 0o700 });
    fs.chmodSync(root, 0o700);
    fs.chmodSync(this.sessions, 0o700);
  }

  directory(id) {
    if (!ID_PATTERN.test(id)) throw new Error('Invalid saved terminal ID.');
    return path.join(this.sessions, id);
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
      const cwd = fs.readFileSync(path.join(directory, 'cwd'), 'utf8');
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
          session.updatedAt = Math.max(fs.statSync(path.join(this.directory(id), 'history')).mtimeMs,
            fs.statSync(path.join(this.directory(id), 'cwd')).mtimeMs, Date.parse(session.lastUsedAt || '') || 0);
          result.push(session);
        }
      } catch { /* A damaged session must not hide the other recoverable sessions. */ }
    }
    return result.sort((a, b) => b.updatedAt - a.updatedAt);
  }
}

module.exports = { SessionStore, workspaceKey };
