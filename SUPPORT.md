# Support

Use the **Q & A** tab on the Console Session Resume Marketplace listing to report
an issue or ask a question. Include the extension version, VS Code version,
operating system, shell and version, and whether the terminal is local, WSL,
Remote SSH or a container. A small set of harmless reproduction commands is useful.

For recovery problems, describe whether you closed a terminal, closed a project,
quit the editor, or rebooted. Include what **Session Resume: Resume Saved Terminal**
shows. Avoid sharing actual history files, credentials, tokens, or private paths.

If upgrading from the earlier `local-tools` build, disable that extension and reload
before enabling the `bmukheja` build. Keep its storage files until the imported
sessions appear under Saved Terminals. Original histories are preserved.

This is a preview release. Current local verification covers macOS with Bash,
Zsh and PowerShell 7. Fish passed earlier 0.2.0 checks; it is not installed for the
current local run. Windows PowerShell 5.1, Git Bash, Linux and remote hosts require
additional platform validation before their behavior can be claimed as verified.
