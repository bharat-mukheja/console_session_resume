'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { SessionStore, workspaceKey } = require('./store');
const { SHELLS, findExecutable, installBootstraps, launchOptions, historyPath } = require('./shells');
const { identifyTerminal } = require('./identity');
const { HistoryPreview } = require('./history');
const { chooseSession, createSessionsView } = require('./resume-ui');

function activate(context) {
  return createController(context, require('vscode'));
}

function createController(context, vscode) {
  const store = new SessionStore(context.globalStorageUri.fsPath);
  // A revived terminal must not depend on an old version's extension install path.
  installBootstraps(store.root, context.extensionPath);
  const workspace = workspaceKey(vscode.workspace.workspaceFile
    ? [vscode.workspace.workspaceFile.toString()]
    : (vscode.workspace.workspaceFolders || []).map(folder => folder.uri.toString()));

  const config = () => vscode.workspace.getConfiguration('sessionResume');
  const previews = new HistoryPreview();
  const pendingResumes = new Map();
  const resumeUI = {};
  let sessionsView;
  const refresh = () => sessionsView?.scheduleRefresh();
  const identityCache = new WeakMap();
  const managedId = async terminal => {
    if (identityCache.has(terminal)) return identityCache.get(terminal);
    const id = await identifyTerminal(terminal, store, workspace);
    if (id) identityCache.set(terminal, id);
    return id;
  };

  function options(session) {
    return launchOptions(session, { store, config: config(), appRoot: vscode.env.appRoot,
      shellIntegration: vscode.workspace.getConfiguration('terminal.integrated').get('shellIntegration.enabled', true) });
  }

  async function pickShell() {
    const available = Object.entries(SHELLS).filter(([kind]) => {
      try { findExecutable(kind, config().get('shellPaths', {})[kind]); return true; } catch { return false; }
    }).map(([kind, spec]) => ({ label: spec.title, kind }));
    const selected = await vscode.window.showQuickPick(available, { placeHolder: 'Shell for this terminal' });
    return selected?.kind;
  }

  async function freshSession(args = {}) {
    const shell = args.shell || await pickShell();
    if (!shell) return;
    let cwd = args.cwd;
    if (!cwd) {
      const folders = vscode.workspace.workspaceFolders || [];
      let folder = folders[0];
      if (folders.length > 1) {
        const selected = await vscode.window.showQuickPick(folders.map(item => ({ label: item.name, folder: item })), { placeHolder: 'Project for this terminal' });
        if (!selected) return;
        folder = selected.folder;
      }
      cwd = folder?.uri.fsPath || os.homedir();
    }
    const prefix = `${path.basename(cwd) || 'Terminal'} · ${SHELLS[shell].title.replace(' (Session Resume)', '')}`;
    const existingNames = new Set(store.list(workspace).map(session => session.name));
    let number = 1;
    while (existingNames.has(`${prefix} ${number}`)) number++;
    let name = args.name || `${prefix} ${number}`;
    if (args.promptForName) {
      name = await vscode.window.showInputBox({ title: 'Name this terminal', prompt: 'For example: API server, Tests, Database',
        value: name, validateInput: validateName });
      if (!name) return;
    }
    const session = store.create({ name: name.trim(), cwd, workspace, shell });
    refresh();
    return session;
  }

  async function newTerminal(args) {
    const session = await freshSession(args || { promptForName: true });
    if (!session) return;
    const terminal = vscode.window.createTerminal(options(session));
    terminal.show();
    refresh();
    return terminal;
  }

  const sessionId = value => typeof value === 'string' ? value : value?.id;
  function savedSession(value) {
    const session = store.get(sessionId(value));
    if (session.workspace !== workspace) throw new Error('This saved terminal belongs to another workspace.');
    return session;
  }

  async function listSessions() {
    const sessions = store.list(workspace);
    const terminals = new Map();
    for (const terminal of [...vscode.window.terminals]) {
      try {
        const id = await managedId(terminal);
        if (id) terminals.set(id, terminal);
      } catch { /* A terminal may close while the list is being refreshed. */ }
    }
    return sessions.map(session => ({ ...session, terminal: terminals.get(session.id),
      commands: previews.read(historyPath(session, store), session.shell || 'bash') }));
  }

  async function pickSavedTerminal(query = '', request = {}) {
    for (;;) {
      const sessions = await listSessions();
      if (!sessions.length) {
        const action = await vscode.window.showInformationMessage('No saved terminals in this project yet.', 'New terminal');
        if (action) return newTerminal();
        return;
      }
      const selected = await chooseSession(vscode, sessions, query, picker => { resumeUI.picker = picker; });
      resumeUI.picker = undefined;
      if (!selected) return;
      const id = selected.session.id;
      if (selected.action === 'resume') return resumeTerminal(id, request);
      if (selected.action === 'split') return resumeTerminal(id, { split: true });
      if (selected.action === 'preview') return previewHistory(id);
      if (selected.action === 'rename') await renameSession(id);
      if (selected.action === 'pin') await pinSession(id);
      query = selected.query;
    }
  }

  async function resumeTerminal(value, request = {}) {
    const id = sessionId(value);
    if (!id) return pickSavedTerminal('', request);
    if (pendingResumes.has(id)) return pendingResumes.get(id);
    const pending = resumeById(id, request);
    pendingResumes.set(id, pending);
    try { return await pending; }
    finally { pendingResumes.delete(id); }
  }

  async function resumeById(id, request) {
    const session = savedSession(id);
    // Never create two writers to one history file within this VS Code window.
    let existing;
    for (const terminal of vscode.window.terminals) {
      if (await managedId(terminal) === id) { existing = terminal; break; }
    }
    if (existing) {
      existing.show();
      store.update(id, { lastUsedAt: new Date().toISOString() });
      refresh();
      return existing;
    }
    const launch = options(session);
    if (request.split && vscode.window.activeTerminal) launch.location = { parentTerminal: vscode.window.activeTerminal };
    const terminal = vscode.window.createTerminal(launch);
    terminal.show();
    store.update(id, { lastUsedAt: new Date().toISOString() });
    refresh();
    return terminal;
  }

  function validateName(value) {
    return !value.trim() || value.trim().length > 120 || /[\x00-\x1f\x7f]/.test(value)
      ? 'Use a name of 1–120 characters on one line.' : undefined;
  }

  async function targetSession(value) {
    let id = sessionId(value);
    if (!id && vscode.window.activeTerminal) id = await managedId(vscode.window.activeTerminal);
    if (!id) {
      const sessions = await listSessions();
      const selected = await vscode.window.showQuickPick(sessions.map(session => ({ label: session.name,
        description: session.shell, detail: session.cwd, session })), { placeHolder: 'Choose a saved terminal' });
      if (!selected) return;
      id = selected.session.id;
    }
    return savedSession(id);
  }

  async function renameSession(value, requestedName) {
    const session = await targetSession(value);
    if (!session) return;
    const name = requestedName === undefined ? await vscode.window.showInputBox({ title: 'Rename saved terminal',
      value: session.name, prompt: 'This name is kept when you resume the terminal.', validateInput: validateName }) : requestedName;
    if (name === undefined) return;
    const validation = validateName(name);
    if (validation) throw new Error(validation);
    for (const terminal of vscode.window.terminals) {
      if (await managedId(terminal) === session.id) {
        terminal.show();
        await vscode.commands.executeCommand('workbench.action.terminal.renameWithArg', { name: name.trim() });
        break;
      }
    }
    store.update(session.id, { name });
    refresh();
  }

  async function pinSession(value, pinned) {
    const session = await targetSession(value);
    if (!session) return;
    store.update(session.id, { pinned: pinned === undefined ? !session.pinned : pinned });
    refresh();
  }

  async function previewHistory(value) {
    const session = await targetSession(value);
    if (!session) return;
    const commands = previews.read(historyPath(session, store), session.shell || 'bash');
    const content = `${session.name}\n${session.cwd}\n\nRecent recorded commands (oldest first)\n${'─'.repeat(40)}\n\n`
      + (commands.length ? commands.join('\n\n') : 'No recorded commands yet.') + '\n';
    const document = await vscode.workspace.openTextDocument({ content, language: 'plaintext' });
    await vscode.window.showTextDocument(document, { preview: true });
  }

  async function resumeAll() {
    const saved = (await listSessions()).filter(session => !session.terminal);
    for (const session of saved) await resumeTerminal(session.id);
    if (!saved.length) vscode.window.showInformationMessage('Your saved terminals are already open.');
    return saved.length;
  }

  const guarded = fn => async (...args) => {
    try { return await fn(...args); }
    catch (error) { vscode.window.showErrorMessage(`Session Resume: ${error.message}`); }
  };

  for (const shell of Object.keys(SHELLS)) {
    context.subscriptions.push(vscode.window.registerTerminalProfileProvider(`sessionResume.${shell}`, {
      provideTerminalProfile: guarded(async () => {
        const session = await freshSession({ shell });
        return session ? new vscode.TerminalProfile(options(session)) : undefined;
      })
    }));
  }
  const commands = {
    'sessionResume.newTerminal': newTerminal,
    'sessionResume.resumeTerminal': resumeTerminal,
    'sessionResume.resumeInSplit': value => resumeTerminal(value, { split: true }),
    'sessionResume.renameSession': renameSession,
    'sessionResume.pinSession': value => pinSession(value, true),
    'sessionResume.unpinSession': value => pinSession(value, false),
    'sessionResume.previewHistory': previewHistory,
    'sessionResume.resumeAll': resumeAll,
    'sessionResume.refreshSessions': () => sessionsView.refresh(),
    'sessionResume.useAsDefault': async requestedShell => {
      const shell = typeof requestedShell === 'string' ? requestedShell : await pickShell();
      if (!shell) return;
      if (!SHELLS[shell]) throw new Error(`Unsupported shell: ${shell}`);
      const platform = process.platform === 'darwin' ? 'osx' : process.platform;
      const platformSetting = platform === 'win32' ? 'windows' : platform;
      const integrated = vscode.workspace.getConfiguration('terminal.integrated');
      const profiles = { ...integrated.get(`profiles.${platformSetting}`, {}) };
      profiles[SHELLS[shell].title] = {
        extensionIdentifier: context.extension?.id || 'local-tools.console-session-resume',
        id: `sessionResume.${shell}`, title: SHELLS[shell].title
      };
      await integrated.update(`profiles.${platformSetting}`, profiles, vscode.ConfigurationTarget.Global);
      await integrated.update(`defaultProfile.${platformSetting}`, SHELLS[shell].title, vscode.ConfigurationTarget.Global);
      await integrated.update('enablePersistentSessions', true, vscode.ConfigurationTarget.Global);
      await integrated.update('persistentSessionReviveProcess', 'onExitAndWindowClose', vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage('New terminals now use separate histories. Existing terminals keep their current profiles.');
    },
    'sessionResume.openHistory': async () => {
      const id = vscode.window.activeTerminal && await managedId(vscode.window.activeTerminal);
      if (!id) throw new Error('The active terminal was not created with Session Resume.');
      await vscode.window.showTextDocument(vscode.Uri.file(historyPath(store.get(id), store)));
    }
  };
  for (const [command, handler] of Object.entries(commands)) {
    context.subscriptions.push(vscode.commands.registerCommand(command, guarded(handler)));
  }
  const rememberCwd = async terminal => {
    try {
      const id = await managedId(terminal);
      const cwd = terminal.shellIntegration?.cwd;
      if (!id || !cwd) return;
      fs.writeFileSync(path.join(store.directory(id), 'cwd'), cwd.fsPath, { mode: 0o600 });
      const session = store.get(id);
      if (terminal.name && session.name !== terminal.name && !validateName(terminal.name)) store.update(id, { name: terminal.name });
      refresh();
    } catch { /* History saving is independent of directory tracking. */ }
  };
  if (vscode.window.onDidEndTerminalShellExecution) {
    context.subscriptions.push(vscode.window.onDidEndTerminalShellExecution(event => rememberCwd(event.terminal)));
    context.subscriptions.push(vscode.window.onDidChangeTerminalShellIntegration(event => rememberCwd(event.terminal)));
  }
  sessionsView = createSessionsView(vscode, context, listSessions);
  for (const event of ['onDidOpenTerminal', 'onDidCloseTerminal', 'onDidChangeActiveTerminal']) {
    if (vscode.window[event]) context.subscriptions.push(vscode.window[event](refresh));
  }
  refresh();
  return { store, workspace, options, newTerminal, resumeTerminal, identifyTerminal: managedId, listSessions,
    renameSession, pinSession, previewHistory, resumeAll, sessionsView, resumeUI };
}

module.exports = { activate, createController };
