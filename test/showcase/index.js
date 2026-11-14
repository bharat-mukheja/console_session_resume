'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');
const manifest = require('../../package.json');

async function until(predicate, label) {
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Showcase did not reach ${label}`);
}

async function run() {
  const project = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (project !== path.resolve(__dirname, '../../.test-work/showcase/orbit-api')) return;
  const base = path.dirname(project);
  const home = path.join(base, 'home');
  fs.mkdirSync(home, { recursive: true });
  for (const name of ['.bashrc', '.bash_profile']) fs.writeFileSync(path.join(home, name), "PS1='orbit-api $ '\n");
  for (const [key, value] of Object.entries({ 'workbench.colorTheme': 'Default Dark Modern', 'git.enabled': false,
    'editor.fontSize': 15, 'terminal.integrated.fontSize': 14, 'terminal.integrated.tabs.enabled': true,
    'terminal.integrated.tabs.hideCondition': 'never', 'window.commandCenter': false })) {
    await vscode.workspace.getConfiguration().update(key, value, vscode.ConfigurationTarget.Global);
  }
  process.env.HOME = home;
  process.env.XDG_DATA_HOME = path.join(home, '.local', 'share');
  const platform = process.platform === 'darwin' ? 'osx' : 'linux';
  await vscode.workspace.getConfiguration('terminal.integrated').update(`env.${platform}`, { HOME: home,
    XDG_DATA_HOME: process.env.XDG_DATA_HOME }, vscode.ConfigurationTarget.Global);
  const api = await vscode.extensions.getExtension(`${manifest.publisher}.${manifest.name}`).activate();
  const stateFile = path.join(base, 'state.json');
  const writeState = value => fs.writeFileSync(stateFile, JSON.stringify(value));
  try {
    for (const terminal of vscode.window.terminals) terminal.dispose();
    await until(() => vscode.window.terminals.length === 0, 'previous sample terminals closed');
    const definitions = [
      { name: 'API server', command: 'npm run dev', saved: false },
      { name: 'Test suite', command: 'npm test', saved: true, pinned: true },
      { name: 'Database migrations', command: 'npm run db:migrate', saved: true }
    ];
    const sessionIds = [];
    for (const definition of definitions) {
      const saved = (await api.listSessions()).find(session => session.name === definition.name);
      const terminal = saved ? await api.resumeTerminal(saved.id) : await api.newTerminal({ name: definition.name, cwd: project, shell: 'bash' });
      const id = terminal.creationOptions.env.CSR_SESSION_ID;
      sessionIds.push(id);
      await until(() => terminal.shellIntegration, 'Bash prompt');
      await new Promise(resolve => setTimeout(resolve, 700));
      terminal.sendText(definition.command);
      await until(() => fs.readFileSync(terminal.creationOptions.env.CSR_HISTORY_FILE, 'utf8').includes(definition.command), 'saved command');
      if (definition.pinned) await api.pinSession(id, true);
      if (definition.saved) terminal.dispose();
    }
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(project, 'README.md'))));
    await vscode.commands.executeCommand('sessionResume.sessions.focus');
    await api.sessionsView.refresh();
    writeState({ ready: true, scene: 'sessions', project, sessionIds });
    let scene = 'sessions';
    const timer = setInterval(async () => {
      const control = path.join(base, 'scene.txt');
      if (!fs.existsSync(control)) return;
      const next = fs.readFileSync(control, 'utf8').trim();
      if (next === scene) return;
      scene = next;
      if (next === 'picker') {
        api.resumeTerminal().catch(console.error);
        await until(() => api.resumeUI.picker, 'resume picker');
      } else {
        await vscode.commands.executeCommand('workbench.action.closeQuickOpen');
        if (next === 'preview') await api.previewHistory(sessionIds[1]);
        if (next === 'sessions') await vscode.commands.executeCommand('sessionResume.sessions.focus');
        if (next === 'quit') { clearInterval(timer); await vscode.commands.executeCommand('workbench.action.closeWindow'); }
      }
      writeState({ ready: true, scene: next, project, sessionIds });
    }, 200);
  } catch (error) { writeState({ ready: false, error: error.stack }); }
}
module.exports = { run };
