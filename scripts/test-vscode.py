"""Verify native terminal behavior in an isolated VS Code user profile.

Requires a graphical VS Code installation and Bash; other available adapters are
tested too. No settings or extensions in the normal VS Code profile are changed.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

root = Path(__file__).resolve().parents[1]
version = json.loads((root / "package.json").read_text())["version"]
code = shutil.which("code")
if not code:
    raise SystemExit("VS Code's 'code' CLI is required.")
shells = {kind: shutil.which(kind) for kind in ["bash", "zsh", "fish", "pwsh"]}
if os.environ.get("CSR_TEST_FISH"):
    shells["fish"] = os.environ["CSR_TEST_FISH"]
shells = {kind: executable for kind, executable in shells.items() if executable}
if "bash" not in shells:
    raise SystemExit("The native restart test currently requires Bash on the test host.")
work = root / ".test-work"
project = work / ("project-v" + version)
user = work / "user"
extensions = work / "extensions"
harness = work / "harness"
for directory in [project, user / "User", harness]:
    directory.mkdir(parents=True, exist_ok=True)
(project / "shells.json").write_text(json.dumps(shells))
for marker in ["hold-ui", "ux-ready", "continue-ui"]:
    (project / marker).unlink(missing_ok=True)
if os.environ.get("CSR_TEST_HOLD_UI"):
    (project / "hold-ui").write_text("hold")
(user / "User/settings.json").write_text(json.dumps({
    "security.workspace.trust.enabled": False, "update.mode": "none",
    "telemetry.telemetryLevel": "off", "workbench.startupEditor": "none",
    "window.restoreWindows": "all", "terminal.integrated.confirmOnExit": "never",
    "terminal.integrated.confirmOnKill": "never",
}))
(harness / "package.json").write_text(json.dumps({
    "name": "session-resume-harness", "publisher": "local-tests", "version": "0.0.1",
    "engines": {"vscode": "^1.93.0"}, "main": "./extension.js",
    "activationEvents": ["onStartupFinished"],
}))
(harness / "extension.js").write_text(
    "exports.activate = async () => { try { await require("
    + json.dumps(str(root / "test/vscode"))
    + ").run(); } catch (error) { console.error(error); } finally { "
    "await require('vscode').commands.executeCommand('workbench.action.quit'); } };\n")
subprocess.run([sys.executable, str(root / "scripts/package.py")], check=True)
base = [code, "--user-data-dir", str(user), "--extensions-dir", str(extensions)]
subprocess.run(base + ["--install-extension", str(root / f"dist/console-session-resume-{version}.vsix"), "--force"], check=True, timeout=60)
results = []
for stage in os.environ.get("CSR_TEST_STAGES", "create,revive,adapters,ux").split(","):
    result_file = project / "test-result.json"
    result_file.unlink(missing_ok=True)
    (project / "stage.txt").write_text(stage)
    print(f"Testing native VS Code terminals: {stage}", flush=True)
    subprocess.run(base + ["--new-window", "--wait", f"--extensionDevelopmentPath={harness}",
        "--skip-welcome", "--skip-release-notes", "--disable-workspace-trust", str(project)], check=True, timeout=180)
    # --wait releases when the window closes, before main finishes flushing its
    # terminal snapshot. Wait for the isolated main process to exit before reopening.
    main_pid = int((project / "main.pid").read_text())
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if os.name == "nt":
            alive = str(main_pid) in subprocess.check_output(
                ["tasklist", "/FI", f"PID eq {main_pid}", "/FO", "CSV", "/NH"], text=True)
        else:
            try:
                os.kill(main_pid, 0)
                alive = True
            except ProcessLookupError:
                alive = False
        if not alive:
            break
        time.sleep(0.1)
    else:
        raise SystemExit("The isolated VS Code main process did not exit after the test window closed.")
    deadline = time.monotonic() + 5
    while not result_file.exists() and time.monotonic() < deadline:
        time.sleep(0.1)
    result = json.loads(result_file.read_text())
    results.append(result)
    print(json.dumps(result), flush=True)
    if not result.get("passed"):
        raise SystemExit("Native VS Code verification failed.")
(work / "validation.json").write_text(json.dumps(results, indent=2) + "\n")
print("Requested native VS Code checks passed.")
