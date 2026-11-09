'use strict';

const os = require('node:os');
const path = require('node:path');
const { SHELLS } = require('./shells');
const { cleanText } = require('./history');

function relativeTime(timestamp, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  const days = Math.floor(minutes / 1440);
  return days === 1 ? 'yesterday' : `${days}d ago`;
}

function shortPath(cwd) {
  const home = os.homedir();
  return cwd === home ? '~' : cwd.startsWith(home + path.sep) ? '~' + cwd.slice(home.length) : cwd;
}

function compact(text, limit = 160) {
  const value = cleanText(text).replace(/\s+/g, ' ');
  return value.length > limit ? value.slice(0, limit - 1) + '…' : value;
}

const shellLabel = session => (SHELLS[session.shell || 'bash']?.title || session.shell).replace(' (Session Resume)', '');
const literal = text => text.replace(/\$\(/g, '\\$(');

function groupSessions(sessions) {
  return [
    { label: 'Pinned', key: 'pinned', sessions: sessions.filter(session => session.pinned) },
    { label: 'Open', key: 'open', sessions: sessions.filter(session => !session.pinned && session.terminal) },
    { label: 'Saved', key: 'saved', sessions: sessions.filter(session => !session.pinned && !session.terminal) }
  ].filter(group => group.sessions.length);
}

function quickPickItems(sessions, vscode) {
  const items = [];
  for (const group of groupSessions(sessions)) {
    items.push({ label: group.label, kind: vscode.QuickPickItemKind.Separator });
    for (const session of group.sessions) {
      const recent = session.commands.slice(-3).reverse().map(command => compact(command)).join('  ·  ');
      items.push({
        label: literal(session.name),
        description: `${shellLabel(session)} · ${session.terminal ? 'Open' : 'Saved'} · ${relativeTime(session.updatedAt)}`,
        detail: literal(`${shortPath(session.cwd)}${recent ? '   —   ' + recent : '   —   No recorded commands yet'}`),
        session,
        buttons: [
          { iconPath: new vscode.ThemeIcon(session.pinned ? 'pinned' : 'pin'), tooltip: session.pinned ? 'Unpin terminal' : 'Pin terminal', action: 'pin' },
          { iconPath: new vscode.ThemeIcon('edit'), tooltip: 'Rename terminal', action: 'rename' },
          { iconPath: new vscode.ThemeIcon('preview'), tooltip: 'Preview recent commands', action: 'preview' },
          ...(!session.terminal ? [{ iconPath: new vscode.ThemeIcon('split-horizontal'), tooltip: 'Resume in split', action: 'split' }] : [])
        ]
      });
    }
  }
  return items;
}

async function chooseSession(vscode, sessions, query = '', onShow) {
  const picker = vscode.window.createQuickPick();
  picker.title = 'Resume a terminal';
  picker.placeholder = 'Search by name, folder, shell, or recent command';
  picker.matchOnDescription = true;
  picker.matchOnDetail = true;
  picker.items = quickPickItems(sessions, vscode);
  picker.value = query;
  if (!query) picker.activeItems = picker.items.filter(item => item.session).slice(0, 1);
  return new Promise(resolve => {
    const disposables = [];
    let finished = false;
    const finish = value => {
      if (finished) return;
      finished = true;
      for (const disposable of disposables) disposable.dispose();
      picker.hide();
      picker.dispose();
      resolve(value);
    };
    disposables.push(picker.onDidAccept(() => {
      const selected = picker.selectedItems[0] || picker.activeItems[0];
      if (selected?.session) finish({ action: 'resume', session: selected.session });
    }));
    disposables.push(picker.onDidTriggerItemButton(event => finish({ action: event.button.action, session: event.item.session, query: picker.value })));
    disposables.push(picker.onDidHide(() => finish(undefined)));
    picker.show();
    onShow?.(picker);
  });
}

function createSessionsView(vscode, context, listSessions) {
  const emitter = new vscode.EventEmitter();
  let rows = [];
  let refreshTimer;
  let generation = 0;
  let disposed = false;
  const provider = {
    onDidChangeTreeData: emitter.event,
    getChildren: element => !element ? groupSessions(rows) : element.sessions || [],
    getTreeItem: element => {
      if (element.sessions) {
        const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
        item.id = `group:${element.key}`;
        item.description = String(element.sessions.length);
        return item;
      }
      const item = new vscode.TreeItem(element.name, vscode.TreeItemCollapsibleState.None);
      item.id = element.id;
      item.description = `${shellLabel(element)} · ${relativeTime(element.updatedAt)}`;
      item.iconPath = new vscode.ThemeIcon(element.terminal ? 'terminal' : 'history');
      item.tooltip = `${element.name}\n${element.terminal ? 'Open — click to focus' : 'Saved — click to resume'}\n${shortPath(element.cwd)}\n\n${element.commands.slice(-3).reverse().map(command => compact(command, 240)).join('\n') || 'No recorded commands yet'}`;
      item.contextValue = `session${element.terminal ? 'Open' : 'Saved'}${element.pinned ? 'Pinned' : ''}`;
      item.command = { command: 'sessionResume.resumeTerminal', title: element.terminal ? 'Focus terminal' : 'Resume terminal', arguments: [element.id] };
      return item;
    }
  };
  const view = vscode.window.createTreeView('sessionResume.sessions', { treeDataProvider: provider, showCollapseAll: true });
  const status = vscode.window.createStatusBarItem('sessionResume.resume', vscode.StatusBarAlignment.Left, 1);
  status.name = 'Resume saved terminal';
  status.command = 'sessionResume.resumeTerminal';
  status.text = '$(history) Resume';
  const refresh = async () => {
    const version = ++generation;
    const next = await listSessions();
    if (disposed || version !== generation) return;
    rows = next;
    view.description = rows.length ? `${rows.length} sessions` : '';
    const saved = rows.filter(row => !row.terminal).length;
    status.tooltip = saved ? `Resume ${saved} saved terminal${saved === 1 ? '' : 's'} — search names, folders, and recent commands` : 'Find an open terminal or resume a saved one';
    if (rows.length) status.show(); else status.hide();
    emitter.fire();
  };
  const scheduleRefresh = () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { refresh().catch(() => {}); }, 250);
  };
  context.subscriptions.push(view, status, emitter, { dispose() { disposed = true; clearTimeout(refreshTimer); } });
  context.subscriptions.push(view.onDidChangeVisibility(event => { if (event.visible) scheduleRefresh(); }));
  return { refresh, scheduleRefresh, provider, view, status };
}

module.exports = { chooseSession, createSessionsView, groupSessions, quickPickItems, relativeTime, compact };
