"""Native history persistence tests for the other shells installed on this host."""
import os
from pathlib import Path
import pty
import shutil
import struct
import tempfile
import termios
import fcntl
import unittest

from shell_test import Shell, PROMPT

ROOT = Path(__file__).resolve().parents[1]


class AdapterShell(Shell):
    def __init__(self, kind, home, directory):
        env = {k: v for k, v in os.environ.items() if not k.startswith(("VSCODE_", "CSR_", "ATUIN_"))}
        env.update({
            "HOME": str(home), "TERM": "xterm-256color", "TERM_PROGRAM": "vscode",
            "CSR_SESSION_ID": directory.name, "CSR_SESSION_DIR": str(directory),
            "CSR_HISTORY_FILE": str(directory / "history"), "CSR_HISTORY_SIZE": "20000",
            "CSR_INTEGRATION_SCRIPT": "", "XDG_DATA_HOME": str(home / ".local/share"),
            "CSR_BOOTSTRAP": str(ROOT / "shell" / f"bootstrap.{ 'ps1' if kind == 'pwsh' else kind}"),
            "PSModuleAnalysisCachePath": str(home / "module-cache"),
        })
        if kind == "zsh":
            env.update({"ZDOTDIR": str(ROOT / "shell/zsh"), "CSR_ORIGINAL_ZDOTDIR": str(home)})
            argv = [shutil.which("zsh"), "-i"]
        elif kind == "fish":
            env["fish_history"] = env["CSR_FISH_HISTORY"] = "csr_" + directory.name.replace("-", "_")
            argv = [shutil.which("fish"), "-i", "-C", 'source "$CSR_BOOTSTRAP"']
        else:
            script = "function global:prompt { '__CSR_TEST_PROMPT__> ' };\n" + (ROOT / "shell/bootstrap.ps1").read_text()
            argv = [shutil.which("pwsh"), "-NoLogo", "-NoProfile", "-NoExit", "-Command", script]
        self.pid, self.fd = pty.fork()
        if self.pid == 0:
            fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 200, 0, 0))
            os.chdir(home)
            os.execve(argv[0], argv, env)
        self.pending = b""
        self.until_prompt(timeout=20)

    def until_prompt(self, timeout=8):
        # PSReadLine queries the cursor position when drawing its input line.
        import select
        import time
        deadline = time.monotonic() + timeout
        while PROMPT not in self.pending:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise AssertionError(f"No shell prompt: {self.pending!r}")
            ready, _, _ = select.select([self.fd], [], [], remaining)
            if ready:
                chunk = os.read(self.fd, 65536)
                self.pending += chunk
                if b"\x1b[6n" in chunk:
                    os.write(self.fd, b"\x1b[1;1R")
        result, self.pending = self.pending.split(PROMPT, 1)
        return result.decode(errors="replace")


class OtherShellTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="session-resume-adapters-")
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        (self.home / ".zsh_history").write_text("echo GLOBAL_ZSH_MUST_NOT_APPEAR\n")
        (self.home / ".zshrc").write_text(
            "PROMPT='__CSR_TEST_PROMPT__> '\nHISTFILE=$HOME/.zsh_history\nSAVEHIST=1000\nsetopt SHARE_HISTORY\n")
        fish_config = self.home / ".config/fish/config.fish"
        fish_config.parent.mkdir(parents=True)
        fish_config.write_text("function fish_prompt; printf '__CSR_TEST_PROMPT__> '; end\n")

    def shell(self, kind, directory):
        shell = AdapterShell(kind, self.home, directory)
        self.addCleanup(shell.kill)
        return shell

    def check_shell(self, kind):
        directories = [self.home / "tab-a", self.home / "tab-b"]
        for directory in directories:
            directory.mkdir()
            (directory / "history").touch()
            (directory / "cwd").touch()
        a, b = [self.shell(kind, directory) for directory in directories]
        a.run("echo ONLY_ADAPTER_TAB_A")
        b.run("echo ONLY_ADAPTER_TAB_B")
        a.kill()
        b.kill()
        a, b = [self.shell(kind, directory) for directory in directories]
        history_command = {"zsh": "fc -l 1", "fish": "history", "pwsh": "Get-Content -LiteralPath $env:CSR_HISTORY_FILE"}[kind]
        history_a, history_b = a.run(history_command), b.run(history_command)
        self.assertIn("ONLY_ADAPTER_TAB_A", history_a)
        self.assertNotIn("ONLY_ADAPTER_TAB_B", history_a)
        self.assertIn("ONLY_ADAPTER_TAB_B", history_b)
        self.assertNotIn("ONLY_ADAPTER_TAB_A", history_b)
        self.assertNotIn("GLOBAL_ZSH_MUST_NOT_APPEAR", history_a + history_b)
        a.run("echo ADAPTER_NATIVE_UP")
        a.kill()
        a = self.shell(kind, directories[0])
        self.assertIn("ADAPTER_NATIVE_UP", a.run("\x1b[A"))
        a.kill()
        b.kill()
        self.assertEqual((self.home / ".zsh_history").read_text(), "echo GLOBAL_ZSH_MUST_NOT_APPEAR\n")

    @unittest.skipUnless(shutil.which("zsh"), "zsh is not installed")
    def test_zsh(self):
        self.check_shell("zsh")

    @unittest.skipUnless(shutil.which("pwsh"), "PowerShell is not installed")
    def test_powershell(self):
        self.check_shell("pwsh")

    @unittest.skipUnless(shutil.which("fish"), "fish is not installed")
    def test_fish(self):
        self.check_shell("fish")
