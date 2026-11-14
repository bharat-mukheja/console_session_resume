# Changelog

## 0.3.0 — 2026-11-14

First Marketplace preview candidate under **bmukheja.console-session-resume**.

- Added the extension icon, screenshots, Marketplace description, support and privacy details.
- Replaced custom VSIX generation with Microsoft's official `@vscode/vsce` packager.
- Added preservation and import of sessions from the former `local-tools` publisher.
- Added automated package checks and a manual Trusted Publishing workflow.
- Kept recent commands visible ahead of long project paths in the resume picker.

## 0.2.0 — 2026-11-09

- Added the Saved Terminals view and searchable native resume picker.
- Added session names, pins, command previews, split restoration, and resume-all.

## 0.1.0 — 2026-11-09

- Added per-terminal history persistence for native Bash, Zsh, Fish and PowerShell terminals.
- Added stable session identities and recovery from saved sessions.
