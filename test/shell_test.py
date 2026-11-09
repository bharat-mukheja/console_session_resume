"""Exercise real interactive shells through PTYs, without reading the user's history."""
import os
from pathlib import Path
import pty
import select
import shutil
import signal
import tempfile
import time
import unittest

BOOTSTRAP = Path(__file__).resolve().parents[1] / "shell" / "bootstrap.bash"
PROMPT = b"__CSR_TEST_PROMPT__> "
INTEGRATION = Path("/Applications/Visual Studio Code.app/Contents/Resources/app/out/vs/workbench/contrib/terminal/common/scripts/shellIntegration-bash.sh")
BASHES = list(dict.fromkeys(p for p in ["/bin/bash", shutil.which("bash")] if p))


class Shell:
    def __init__(self, bash, home, directory, integration="", login=False):
        env = os.environ.copy()
        for key in list(env):
            if key.startswith(("CSR_", "VSCODE_", "BASH_FUNC_", "ATUIN_")):
                env.pop(key)
        env.update({
            "HOME": str(home), "TERM": "xterm-256color", "TERM_PROGRAM": "vscode",
            "CSR_SESSION_ID": directory.name, "CSR_SESSION_DIR": str(directory),
            "CSR_HISTORY_FILE": str(directory / "history"), "HISTFILE": str(directory / "history"),
            "CSR_HISTORY_SIZE": "20000", "CSR_STARTUP_MODE": "login" if login else "interactive",
            "CSR_INTEGRATION_SCRIPT": str(integration), "VSCODE_NONCE": "test-nonce",
        })
        self.pid, self.fd = pty.fork()
        if self.pid == 0:
            os.chdir(home)
            os.execve(bash, [bash, "--init-file", str(BOOTSTRAP), "-i"], env)
        self.pending = b""
        self.until_prompt()

    def until_prompt(self, timeout=8):
        deadline = time.monotonic() + timeout
        while PROMPT not in self.pending:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise AssertionError(f"Shell did not reach prompt: {self.pending!r}")
            ready, _, _ = select.select([self.fd], [], [], remaining)
            if ready:
                self.pending += os.read(self.fd, 65536)
        result, self.pending = self.pending.split(PROMPT, 1)
        return result.decode(errors="replace")

    def run(self, command):
        os.write(self.fd, command.encode() + b"\r")
        return self.until_prompt()

    def kill(self):
        if self.pid:
            os.kill(self.pid, signal.SIGKILL)
            os.waitpid(self.pid, 0)
            os.close(self.fd)
            self.pid = None


class BashHistoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="session-resume-shell-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.home = self.root / "home with spaces"
        self.home.mkdir()
        self.global_history = self.home / ".bash_history"
        self.global_history.write_text("echo GLOBAL_HISTORY_MUST_NOT_APPEAR\n")
        (self.home / ".bashrc").write_text(
            "PS1='__CSR_TEST_PROMPT__> '\n"
            "HISTFILE=\"$HOME/.bash_history\"\n"
            "HISTCONTROL=ignoreboth\n"
            "PROMPT_COMMAND='CSR_PREVIOUS_STATUS=$?; history -a; history -n'\n"
            "alias csr_alias='printf alias-preserved'\n"
        )
        (self.home / ".bash_profile").write_text('source "$HOME/.bashrc"\nCSR_LOGIN_LOADED=yes\n')

    def directory(self, name):
        directory = self.root / name
        directory.mkdir(mode=0o700)
        (directory / "history").touch(mode=0o600)
        (directory / "cwd").touch(mode=0o600)
        return directory

    def shell(self, bash, directory, **kwargs):
        shell = Shell(bash, self.home, directory, **kwargs)
        self.addCleanup(shell.kill)
        return shell

    def test_separate_tabs_and_fresh_processes_after_sigkill(self):
        for index, bash in enumerate(BASHES):
            with self.subTest(bash=bash):
                a_dir = self.directory(f"a-{index}")
                b_dir = self.directory(f"b-{index}")
                a = self.shell(bash, a_dir)
                b = self.shell(bash, b_dir)
                a.run("echo ONLY_TAB_A")
                b.run("echo ONLY_TAB_B")
                a.run("false")
                self.assertIn("STATUS:1", a.run('printf "STATUS:%s\\n" "$CSR_PREVIOUS_STATUS"'))
                self.assertIn("alias-preserved", a.run("csr_alias"))
                self.assertIn("ONLY_TAB_A", (a_dir / "history").read_text())
                self.assertNotIn("ONLY_TAB_B", (a_dir / "history").read_text())
                a.kill()
                b.kill()
                # These processes never ran an EXIT trap or shutdown history write.
                a = self.shell(bash, a_dir)
                b = self.shell(bash, b_dir)
                history_a = a.run("history")
                history_b = b.run("history")
                self.assertIn("ONLY_TAB_A", history_a)
                self.assertNotIn("ONLY_TAB_B", history_a)
                self.assertIn("ONLY_TAB_B", history_b)
                self.assertNotIn("ONLY_TAB_A", history_b)
                self.assertNotIn("GLOBAL_HISTORY_MUST_NOT_APPEAR", history_a + history_b)
                # Native Readline Up recalls this terminal's last command.
                a.run("echo UP_ARROW_OWN_HISTORY")
                a.kill()
                a = self.shell(bash, a_dir)
                self.assertIn("UP_ARROW_OWN_HISTORY", a.run("\x1b[A"))
                a.kill()
                b.kill()
                self.assertEqual(self.global_history.read_text(), "echo GLOBAL_HISTORY_MUST_NOT_APPEAR\n")

    def test_multiline_history_and_cwd_survive_without_reexecuting_commands(self):
        for index, bash in enumerate(BASHES):
            with self.subTest(bash=bash):
                directory = self.directory(f"multi-{index}")
                a = self.shell(bash, directory)
                os.write(a.fd, b"for n in one two; do\n  echo MULTILINE_$n\ndone\n")
                a.until_prompt()
                a.run(f"cd '{self.root}'")
                self.assertEqual((directory / "cwd").read_text(), str(self.root))
                a.kill()
                a = self.shell(bash, directory)
                output = a.run("history")
                self.assertIn("MULTILINE_", output)
                self.assertNotIn("MULTILINE_one\r\nMULTILINE_two", output)
                a.kill()

    @unittest.skipUnless(INTEGRATION.exists(), "VS Code's Bash integration script is not installed here")
    def test_vscode_shell_integration_and_login_startup(self):
        for index, bash in enumerate(BASHES):
            with self.subTest(bash=bash):
                directory = self.directory(f"integration-{index}")
                a = self.shell(bash, directory, integration=INTEGRATION, login=True)
                self.assertIn("LOGIN:yes", a.run('printf "LOGIN:%s\\n" "$CSR_LOGIN_LOADED"'))
                a.run("false")
                self.assertIn("STATUS:1", a.run('printf "STATUS:%s\\n" "$CSR_PREVIOUS_STATUS"'))
                a.run("echo INTEGRATED_HISTORY")
                a.kill()
                a = self.shell(bash, directory, integration=INTEGRATION, login=True)
                output = a.run("history")
                self.assertIn("INTEGRATED_HISTORY", output)
                self.assertNotIn("GLOBAL_HISTORY_MUST_NOT_APPEAR", output)
                a.kill()


if __name__ == "__main__":
    unittest.main()
