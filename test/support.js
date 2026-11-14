'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

class Emitter {
  constructor() {
    this.listeners = new Set();
    this.event = callback => { this.listeners.add(callback); return { dispose: () => this.listeners.delete(callback) }; };
  }
  fire(value) { for (const callback of [...this.listeners]) callback(value); }
  dispose() { this.listeners.clear(); }
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'session-resume-extension-'));
  const commands = new Map();
  const providers = new Map();
  const updates = [];
  const quickPicks = [];
  const vscode = {
    EventEmitter: Emitter,
    ThemeIcon: class { constructor(id) { this.id = id; } },
    TreeItem: class { constructor(label, state) { this.label = label; this.collapsibleState = state; } },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    QuickPickItemKind: { Separator: -1 },
    StatusBarAlignment: { Left: 1 },
    env: { appRoot: root },
    workspace: {
      workspaceFolders: [{ name: 'project-a', uri: { fsPath: root, toString: () => `file://${root}` } }],
      // These unit tests never execute a shell. Keep them independent of installed adapters.
      getConfiguration: () => ({ get: (key, fallback) => key === 'shellPaths'
        ? { bash: process.execPath, zsh: process.execPath, fish: process.execPath, pwsh: process.execPath, powershell: process.execPath }
        : fallback, update: async (...args) => updates.push(args) }),
      openTextDocument: async options => ({ ...options, getText: () => options.content })
    },
    window: {
      terminals: [],
      registerTerminalProfileProvider: (id, provider) => { providers.set(id, provider); return { dispose() {} }; },
      createTerminal: creationOptions => {
        const terminal = { creationOptions, name: creationOptions.name,
          show() { this.shown = true; vscode.window.activeTerminal = this; },
          dispose() { vscode.window.terminals = vscode.window.terminals.filter(item => item !== this); }
        };
        vscode.window.terminals.push(terminal);
        return terminal;
      },
      createTreeView: (_id, options) => ({ ...options, onDidChangeVisibility: new Emitter().event, dispose() {} }),
      createStatusBarItem: () => ({ show() { this.visible = true; }, hide() { this.visible = false; }, dispose() {} }),
      createQuickPick: () => {
        const accept = new Emitter();
        const button = new Emitter();
        const hide = new Emitter();
        const picker = { items: [], selectedItems: [], onDidAccept: accept.event, onDidTriggerItemButton: button.event,
          onDidHide: hide.event, accept: () => accept.fire(), pressButton: event => button.fire(event),
          show() { this.shown = true; }, hide: () => hide.fire(), dispose() { this.disposed = true; } };
        quickPicks.push(picker);
        return picker;
      },
      showErrorMessage: message => { throw new Error(message); },
      showInformationMessage() {},
      showQuickPick: async items => items[0],
      showInputBox: async options => options.value,
      showTextDocument: async document => { vscode.document = document; }
    },
    commands: {
      registerCommand: (name, fn) => { commands.set(name, fn); return { dispose() {} }; },
      executeCommand: async (name, ...args) => {
        if (name === 'workbench.action.terminal.renameWithArg') vscode.window.activeTerminal.name = args[0].name;
        else if (commands.has(name)) return commands.get(name)(...args);
      }
    },
    TerminalProfile: class { constructor(options) { this.options = options; } },
    ConfigurationTarget: { Global: 1 }
  };
  const context = { globalStorageUri: { fsPath: path.join(root, 'storage') }, extensionPath: path.resolve(__dirname, '..'), subscriptions: [] };
  t.after(() => {
    for (const subscription of context.subscriptions) subscription.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { context, vscode, commands, providers, updates, quickPicks, root };
}

module.exports = { fixture };
