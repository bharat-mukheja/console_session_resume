# Console Session Resume

Separate command history for each **native VS Code terminal**, across project closes,
editor restarts, and computer reboots. Uses the shell's normal Up/Down and history
search. No terminal multiplexer or replacement terminal UI.

## Install and use

1. In VS Code, run **Extensions: Install from VSIX...** and choose
   `dist/console-session-resume-0.2.0.vsix`.
2. Run **Session Resume: Use as Default Terminal** and choose an installed shell.
   This selects its managed profile and enables VS Code's terminal revival on both
   application exit and window close. Existing terminals retain their old profiles.
3. Open new terminals with the normal **+** button. Each gets its own saved history.
   You can also choose another `… (Session Resume)` profile from the terminal menu,
   or run **Session Resume: New Terminal**.
4. Close/reopen the project or reboot and reopen it. VS Code revives the tabs with
   their original history identities. If VS Code loses a tab or you previously
   closed it, use **Session Resume: Resume Saved Terminal** in that same workspace.

Only managed terminals are recorded. Commands from before installation cannot be
separated retrospectively from a previously merged global history.

## Finding and resuming terminals

Click **Resume** in the status bar, or run **Session Resume: Resume Saved Terminal**.
The native picker searches terminal names, folders, shells, and the last three
recorded commands. Sessions are grouped as **Pinned**, **Open**, and **Saved** and
show when they were last used. Press Enter to resume a saved terminal or focus a
terminal that is already open.

The **Saved Terminals** section in Explorer provides the same sessions as a native
tree. Click a session to open it. Its context menu offers **Rename**, **Pin/Unpin**,
**Preview Recent Commands**, and **Resume in Split**. The view's menu also includes
**Resume All Saved Terminals**, which skips sessions that are already open.

The picker provides the same actions as buttons on each row. Pinning or renaming
keeps the current search text. A history preview opens a copy of the last 30
recorded commands in an editor; editing that copy does not change shell history.
Previews read existing native history files and preserve the shell's history
exclusion rules. They do not execute commands or create a second command log.

New terminals get names such as `my-project · Bash 1`. The explicit **New Terminal**
command lets you name a terminal, and renaming an open terminal updates both its
native tab and saved entry. Names and pins persist across editor restarts.

Installing version 0.2.0 over 0.1.0 keeps the saved session IDs and history files.

## How it works

The extension assigns a UUID **before launching** a terminal. That UUID and the
history location are in the native terminal's launch environment. VS Code persists
the launch environment when reviving a terminal, so a fresh shell process reuses
the same history rather than loading the user's shared history. Recovery metadata
is also stored on disk for the saved-session picker.

| Shell | Native history adapter |
| --- | --- |
| Bash (including macOS Bash 3.2) | Private `HISTFILE`; saves an atomic history snapshot at each prompt. |
| Zsh | Private `HISTFILE`, fresh history context, incremental history saving. |
| Fish | Unique `fish_history` namespace; saves at prompts and before execution. |
| PowerShell 7 / `pwsh` | PSReadLine `HistorySavePath` and `SaveIncrementally`. |
| Windows PowerShell 5.1 | Same PSReadLine adapter; requires PSReadLine. |

PowerShell's `Get-History` remains a record of the current process. Up/Down and
Ctrl+R use the persistent PSReadLine history this extension configures.

Startup profiles and native editing/completion remain available. Existing shell
history exclusion rules still apply. A shell profile that replaces the shell,
disables history, or installs another history manager can require adjustment.

The shell must be installed on the **terminal host**. Native Windows supports
PowerShell and Git Bash; Zsh/Fish run in a WSL or Remote SSH window. Install the
extension on the remote side for Remote SSH / WSL / containers. Classic `cmd.exe`,
`sh`, and legacy shells are not implemented adapters.

## Storage and scope

Session metadata and Bash/Zsh/PowerShell history are stored in this extension's
VS Code global storage directory, outside your projects and outside extension
version directories. On Unix, session directories use mode `0700` and history
files use `0600`. Fish uses its native data directory with a unique `csr_…_history`
file, rather than changing `XDG_DATA_HOME` for your programs.

The saved-session picker is scoped to the workspace file, or to the set of folder
URIs for a folder workspace. Separate projects, worktrees, and remote authorities
remain distinct. Renaming/moving a project changes this lookup scope; existing
revived terminals still refer to their original saved histories.

History is local plaintext, just like ordinary shell history. No network service,
telemetry, command replay, or automatic execution of previous commands is used.

## What survives

- Persisted command history, including normal Up-arrow recall in a fresh process.
- Terminal identity, project association, and the initial/latest available directory.
- Native tab and scrollback restoration through VS Code's own persistence.

Running processes, shell variables, activated environments, and unsaved input do
not survive reboot. Bash saves when the prompt returns: a command still running
at a sudden shutdown may not yet be saved. VS Code's tab restoration can itself
fail after a crash; the saved-session picker does not depend on that snapshot.

## Settings

- `sessionResume.shellPaths`: executable overrides, for example
  `{ "bash": "/bin/bash", "pwsh": "/opt/homebrew/bin/pwsh" }`.
- `sessionResume.startupMode`: `auto` (login profiles on macOS, interactive files
  on Linux), `login`, or `interactive`.
- `sessionResume.historySize`: default 20,000 entries for Bash/Zsh/PowerShell.
  Fish manages its own retention.

To undo the default selection, run **Terminal: Select Default Profile** and choose
your previous profile. Uninstalling the extension does not delete saved histories.
No shell startup files are edited by installing this extension.

## Development

No npm dependencies or build step are required. The extension runs as plain
JavaScript in the VS Code extension host.

```bash
npm test
npm run test:shell
npm run test:vscode
npm run package
```

The shell tests use temporary homes and PTYs. They kill the original processes,
start fresh processes, and verify independent histories and native Up-arrow
recall without modifying your actual shell history.

The VS Code test uses a separate `.test-work` user profile, installs the VSIX
there, creates native tabs and a split, quits the editor, and reopens it to verify
that the same histories are restored. It then exercises each installed shell
adapter in real VS Code terminals. A graphical VS Code installation is required.

### Verified behavior

On macOS with VS Code 1.144.1, the following checks passed:

- Fourteen Node tests covering isolation, persistent IDs, recovery, permissions,
  workspace boundaries, recognition of renamed revived terminals, preview formats,
  search grouping, cancellation, pins, renaming, and concurrent resume requests.
- Six PTY test groups using Bash 3.2.57 and 5.3.20, Zsh 5.9, Fish 4.9.3, and
  PowerShell 7.6.6. These cover fresh processes after forced termination,
  separate histories, native Up-arrow recall, multiline Bash history, and startup hooks.
- Real VS Code terminal creation, independent native splits, complete editor
  exit/reopen, recognition of already-revived tabs, and all four available adapters.
- Native Saved Terminals tree, recent-command previews, tab renaming, pinned
  sessions, keyboard selection in the resume picker, and resume into a native split.

The native UI tests use temporary shell homes and a separate VS Code user profile.
Windows PowerShell 5.1 and Git Bash have not been exercised on a Windows host.
The host computer was not rebooted; persistence was verified by ending the shell
and editor processes and then reopening them from disk.

## Existing tools considered

- [VS Code terminal persistence](https://code.visualstudio.com/docs/terminal/advanced)
  restores buffers and relaunches shells; its shared-history behavior is described
  in [VS Code issue 276489](https://github.com/microsoft/vscode/issues/276489).
- [Atuin](https://github.com/atuinsh/atuin) supports history filtering, but its
  current-session filter alone does not give a revived native tab a stable identity.
- [Terminal Keeper](https://marketplace.visualstudio.com/items?itemName=nguyenngoclong.terminal-keeper)
  manages repeatable startup workflows rather than isolated native shell histories.
- [tmux](https://github.com/tmux/tmux/wiki/Getting-Started) preserves live shells
  across detach/reattach, but introduces a different navigation workflow.
