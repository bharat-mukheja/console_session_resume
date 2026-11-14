# Privacy

Console Session Resume keeps command history on the machine running the terminal.
It does not send command history, session names, working directories, or usage
events to a network service. The extension includes no analytics or telemetry.

History is plaintext, as with ordinary shell history. Bash, Zsh and PowerShell
history and session metadata are stored in the extension's VS Code global storage.
Fish uses a separate, uniquely named history file in its native data directory.
For Remote SSH, WSL and containers, storage is on the remote terminal host.

The extension's previews read those saved history files. Shell settings that omit
commands from saved history also omit them from previews. The extension does not
create a second log of excluded commands. Do not enter credentials directly into
commands that your shell would save.

The upgrade from `local-tools` preserves the original files. An active restored
terminal can continue using its old history, and a closed saved session is copied
to the new storage when resumed. No original session is deleted during import.

Uninstalling does not automatically erase saved history. To remove it, close the
managed terminals and remove the session files from the extension's global storage
and, for Fish, the corresponding `csr_…_history` files. Deleting those files removes
the ability to resume their histories.

VS Code and the Visual Studio Marketplace have their own privacy policies. Support
requests and screenshots you submit to a support channel are shared by your action;
please remove credentials and private commands before posting them.
