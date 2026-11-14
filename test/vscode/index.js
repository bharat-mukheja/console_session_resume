'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

async function until(predicate, description, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${description}`);
}

async function run() {
  const project = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const resultFile = path.join(project, 'test-result.json');
  const manifestFile = path.join(project, 'sessions.json');
  fs.writeFileSync(path.join(project, 'main.pid'), String(process.ppid));
  const testShell = process.platform === 'win32' ? 'pwsh' : 'bash';
  const home = path.join(project, 'home');
  fs.mkdirSync(home, { recursive: true });
  process.env.HOME = home;
  process.env.XDG_DATA_HOME = path.join(home, '.local', 'share');
  const hostPlatform = process.platform === 'darwin' ? 'osx' : process.platform === 'win32' ? 'windows' : 'linux';
  await vscode.workspace.getConfiguration('terminal.integrated').update(`env.${hostPlatform}`,
    { HOME: home, USERPROFILE: home, XDG_DATA_HOME: process.env.XDG_DATA_HOME, APPDATA: path.join(home, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(home, 'AppData', 'Local') }, vscode.ConfigurationTarget.Global);
  const extension = vscode.extensions.getExtension(`${require('../../package.json').publisher}.${require('../../package.json').name}`);
  assert.ok(extension, 'Extension is registered with the actual VS Code host');
  const api = await extension.activate();
  const stageFile = path.join(project, 'stage.txt');
  const stage = fs.existsSync(stageFile) ? fs.readFileSync(stageFile, 'utf8').trim() : (process.env.CSR_TEST_STAGE || 'create');
  try {
    if (stage === 'ux') {
      const terminal = await api.newTerminal({ name: 'API server', cwd: project, shell: testShell });
      const id = terminal.creationOptions.env.CSR_SESSION_ID;
      await until(() => terminal.shellIntegration !== undefined, 'resume UX fixture shell');
      terminal.sendText('echo READY_FOR_RESUME');
      await until(() => fs.readFileSync(terminal.creationOptions.env.CSR_HISTORY_FILE, 'utf8').includes('READY_FOR_RESUME'), 'resume preview fixture saved');
      await api.renameSession(id, 'Backend API');
      await until(() => terminal.name === 'Backend API', 'renaming updates the native terminal tab');
      const tests = api.store.create({ name: 'Test suite', cwd: project, shell: testShell, workspace: api.workspace });
      fs.writeFileSync(path.join(api.store.directory(tests.id), 'history'), '#123\nnpm test\n');
      await api.pinSession(tests.id, true);
      const database = api.store.create({ name: 'Database migrations', cwd: project, shell: testShell, workspace: api.workspace });
      fs.writeFileSync(path.join(api.store.directory(database.id), 'history'), '#123\npython migrate.py\n');
      await api.sessionsView.refresh();
      const groups = api.sessionsView.provider.getChildren();
      assert.equal(groups[0].label, 'Pinned');
      assert.ok(groups[0].sessions.some(session => session.id === tests.id));
      const row = (await api.listSessions()).find(session => session.id === id);
      assert.equal(row.name, 'Backend API');
      assert.ok(row.commands.at(-1).includes('READY_FOR_RESUME'));
      assert.ok(api.sessionsView.provider.getTreeItem(row).tooltip.includes('READY_FOR_RESUME'));
      await api.previewHistory(id);
      assert.ok(vscode.window.activeTextEditor.document.getText().includes('READY_FOR_RESUME'));
      const picking = api.resumeTerminal();
      await until(() => api.resumeUI.picker, 'native resume picker is shown');
      const option = api.resumeUI.picker.items.find(item => item.session?.id === tests.id);
      assert.ok(option.detail.includes('npm test'));
      assert.equal(api.resumeUI.picker.matchOnDetail, true);
      api.resumeUI.picker.activeItems = [option];
      api.resumeUI.picker.selectedItems = [option];
      await new Promise(resolve => setTimeout(resolve, 400));
      await vscode.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
      const chosen = await picking;
      assert.equal(await api.identifyTerminal(chosen), tests.id, 'Enter resumes the first pinned terminal');
      const parent = vscode.window.activeTerminal;
      const split = await api.resumeTerminal(database.id, { split: true });
      assert.equal(split.creationOptions.location.parentTerminal, parent);
      const count = vscode.window.terminals.length;
      assert.equal(await api.resumeTerminal(database.id, { split: true }), split);
      assert.equal(vscode.window.terminals.length, count, 'Repeated resume focuses an existing tab');
      await vscode.commands.executeCommand('sessionResume.sessions.focus');
      await api.sessionsView.refresh();
      if (fs.existsSync(path.join(project, 'hold-ui'))) {
        const visiblePicker = api.resumeTerminal();
        await until(() => api.resumeUI.picker, 'native resume picker for inspection');
        fs.writeFileSync(path.join(project, 'ux-ready'), 'ready');
        await until(() => fs.existsSync(path.join(project, 'continue-ui')), 'visual inspection', 120000);
        await vscode.commands.executeCommand('workbench.action.closeQuickOpen');
        await visiblePicker;
      }
      fs.writeFileSync(resultFile, JSON.stringify({ stage, passed: true, checks: ['native tree', 'command previews', 'rename', 'pin', 'keyboard picker', 'native split', 'focus existing'] }));
    } else if (stage === 'inspect') {
      await new Promise(resolve => setTimeout(resolve, 2000));
      fs.writeFileSync(resultFile, JSON.stringify({ stage, terminals: vscode.window.terminals.map(terminal => ({ name: terminal.name,
        optionKeys: Object.keys(terminal.creationOptions), shellPath: terminal.creationOptions.shellPath,
        args: terminal.creationOptions.shellArgs, id: terminal.creationOptions.env?.CSR_SESSION_ID })) }));
    } else if (stage === 'adapters') {
      const shellPaths = JSON.parse(fs.readFileSync(path.join(project, 'shells.json'), 'utf8'));
      await vscode.workspace.getConfiguration('sessionResume').update('shellPaths', shellPaths, vscode.ConfigurationTarget.Global);
      const results = [];
      for (const shell of Object.keys(shellPaths).filter(kind => fs.existsSync(shellPaths[kind]))) {
        const terminal = await api.newTerminal({ name: `Native ${shell}`, shell, cwd: project });
        const env = terminal.creationOptions.env;
        await until(() => terminal.shellIntegration !== undefined, `${shell} native shell integration`, 30000);
        // The integration handshake can precede PSReadLine's first input read.
        await new Promise(resolve => setTimeout(resolve, 700));
        const token = `CSR_ADAPTER_${shell.toUpperCase()}_${env.CSR_SESSION_ID}`;
        await new Promise(resolve => setTimeout(resolve, 700));
        terminal.sendText(`echo ${token}`);
        await until(() => fs.existsSync(env.CSR_HISTORY_FILE) && fs.readFileSync(env.CSR_HISTORY_FILE, 'utf8').includes(token), `${shell} saves private history`);
        terminal.dispose();
        await until(() => !vscode.window.terminals.includes(terminal), `${shell} closes`);
        const resumed = await api.resumeTerminal(env.CSR_SESSION_ID);
        await until(() => resumed.shellIntegration !== undefined, `${shell} resumed shell integration`);
        await new Promise(resolve => setTimeout(resolve, 700));
        const recallFile = path.join(project, `${shell}.recall`);
        const command = shell === 'zsh' ? `fc -l 1 > '${recallFile}'`
          : ['pwsh', 'powershell'].includes(shell) ? `Get-Content -LiteralPath $env:CSR_HISTORY_FILE | Set-Content -LiteralPath '${recallFile}'`
          : `history > '${recallFile}'`;
        resumed.sendText(command);
        await until(() => fs.existsSync(recallFile) && fs.readFileSync(recallFile, 'utf8').includes(token), `${shell} restores history`);
        results.push({ shell, passed: true });
        resumed.dispose();
      }
      fs.writeFileSync(resultFile, JSON.stringify({ stage, passed: true, results }));
    } else if (stage === 'revive') {
      const saved = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
      await until(async () => {
        const ids = await Promise.all(vscode.window.terminals.map(terminal => api.identifyTerminal(terminal)));
        return saved.every(session => ids.includes(session.id));
      }, 'native terminals revived with stable identities');
      for (const session of saved) {
        let terminal;
        for (const candidate of vscode.window.terminals) {
          if (await api.identifyTerminal(candidate) === session.id) terminal = candidate;
        }
        assert.equal(await api.resumeTerminal(session.id), terminal, 'Resume focuses the already-revived native tab');
        const destination = path.join(project, `${session.id}.recalled`);
        terminal.sendText(testShell === 'pwsh' ? `Get-Content -LiteralPath $env:CSR_HISTORY_FILE | Set-Content -LiteralPath '${destination}'` : `history > '${destination}'`);
        await until(() => fs.existsSync(path.join(project, `${session.id}.recalled`)), 'history recall from revived shell');
        const history = fs.readFileSync(path.join(project, `${session.id}.recalled`), 'utf8');
        assert.ok(history.includes(session.token));
        for (const other of saved.filter(item => item.id !== session.id)) assert.ok(!history.includes(other.token));
      }
      fs.writeFileSync(resultFile, JSON.stringify({ stage, passed: true, revived: saved.length }));
    } else {
      for (const terminal of [...vscode.window.terminals]) terminal.dispose();
      await until(() => vscode.window.terminals.length === 0, 'previous test terminals close');
      await vscode.workspace.getConfiguration('terminal.integrated').update('enablePersistentSessions', true, vscode.ConfigurationTarget.Workspace);
      await vscode.workspace.getConfiguration('terminal.integrated').update('persistentSessionReviveProcess', 'onExitAndWindowClose', vscode.ConfigurationTarget.Workspace);
      const saved = [];
      for (const name of ['API', 'Tests']) {
        const terminal = await api.newTerminal({ name, cwd: project, shell: testShell });
        const id = terminal.creationOptions.env.CSR_SESSION_ID;
        const history = terminal.creationOptions.env.CSR_HISTORY_FILE;
        const token = `CSR_NATIVE_${name.toUpperCase()}_${id}`;
        await until(() => terminal.shellIntegration !== undefined, 'native Bash shell integration');
        await new Promise(resolve => setTimeout(resolve, 700));
        terminal.sendText(`echo ${token}`);
        await until(() => fs.readFileSync(history, 'utf8').includes(token), 'history written to disk');
        saved.push({ id, history, token });
      }
      // Exercise VS Code's built-in split action, which must not reuse a history ID.
      const platform = process.platform === 'darwin' ? 'osx' : process.platform === 'win32' ? 'windows' : 'linux';
      await vscode.commands.executeCommand('sessionResume.useAsDefault', testShell);
      await vscode.workspace.getConfiguration('terminal.integrated').update(`defaultProfile.${platform}`, testShell === 'pwsh' ? 'PowerShell (Session Resume)' : 'Bash (Session Resume)', vscode.ConfigurationTarget.Workspace);
      // Terminal profile discovery refreshes asynchronously after settings change.
      await new Promise(resolve => setTimeout(resolve, 1500));
      const before = vscode.window.terminals.length;
      await vscode.commands.executeCommand('workbench.action.terminal.split');
      await until(() => vscode.window.terminals.length > before, 'native split terminal');
      let ids;
      await until(async () => {
        ids = await Promise.all(vscode.window.terminals.map(t => api.identifyTerminal(t)));
        return ids.length > before && ids.every(Boolean);
      }, 'native split receives a managed history identity');
      assert.equal(new Set(ids).size, ids.length, 'Native split assigns a separate history identity');
      fs.writeFileSync(manifestFile, JSON.stringify(saved));
      fs.writeFileSync(resultFile, JSON.stringify({ stage, passed: true, terminals: saved.length, splitIds: ids }));
    }
  } catch (error) {
    fs.writeFileSync(resultFile, JSON.stringify({ stage, passed: false, error: error.stack,
      terminals: vscode.window.terminals.map(terminal => ({ name: terminal.name, id: terminal.creationOptions.env?.CSR_SESSION_ID,
        shellPath: terminal.creationOptions.shellPath })) }));
    throw error;
  }
}

module.exports = { run };
