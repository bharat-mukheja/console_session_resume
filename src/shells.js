'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const SHELLS = {
  bash: { title: 'Bash (Session Resume)', executable: 'bash', script: 'bootstrap.bash', integration: 'shellIntegration-bash.sh' },
  zsh: { title: 'Zsh (Session Resume)', executable: 'zsh', script: 'zsh', integration: 'shellIntegration-rc.zsh' },
  fish: { title: 'Fish (Session Resume)', executable: 'fish', script: 'bootstrap.fish', integration: 'shellIntegration.fish' },
  pwsh: { title: 'PowerShell (Session Resume)', executable: 'pwsh', script: 'bootstrap.ps1', integration: 'shellIntegration.ps1' },
  powershell: { title: 'Windows PowerShell (Session Resume)', executable: 'powershell.exe', script: 'bootstrap.ps1', integration: 'shellIntegration.ps1' }
};

function findExecutable(kind, configured, platform = process.platform) {
  const spec = SHELLS[kind];
  if (!spec) throw new Error(`Unsupported shell: ${kind}`);
  if (configured) {
    if (!path.isAbsolute(configured)) throw new Error(`The configured ${kind} executable must be an absolute path.`);
    fs.accessSync(configured, fs.constants.X_OK);
    return configured;
  }
  if (platform === 'win32' && kind === 'powershell') {
    const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    if (fs.existsSync(executable)) return executable;
  }
  const names = platform === 'win32' && !spec.executable.endsWith('.exe') ? [`${spec.executable}.exe`, spec.executable] : [spec.executable];
  for (const directory of (process.env.PATH || '').split(path.delimiter)) {
    for (const name of names) {
      const executable = path.join(directory, name);
      try { fs.accessSync(executable, fs.constants.X_OK); return executable; } catch { /* Try the next PATH entry. */ }
    }
  }
  throw new Error(`${spec.executable} is not installed or is not on PATH. Set sessionResume.shellPaths.${kind} to its absolute path.`);
}

function installBootstraps(root, extensionPath) {
  const copy = (source, destination) => {
    const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporary, fs.readFileSync(source), { mode: 0o600 });
    fs.renameSync(temporary, destination);
  };
  for (const name of ['bootstrap.bash', 'bootstrap.ps1', 'bootstrap.fish']) {
    copy(path.join(extensionPath, 'shell', name), path.join(root, name));
  }
  fs.mkdirSync(path.join(root, 'zsh'), { recursive: true, mode: 0o700 });
  for (const name of ['.zshenv', '.zshrc', '.zprofile', '.zlogin', '.zlogout']) {
    copy(path.join(extensionPath, 'shell', 'zsh', name), path.join(root, 'zsh', name));
  }
}

function historyPath(session, store) {
  return session.shell === 'fish'
    ? path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'fish', `csr_${session.id.replaceAll('-', '_')}_history`)
    : path.join(store.runtimeDirectory(session.id), 'history');
}

function launchOptions(session, { store, config, appRoot, shellIntegration = true }) {
  const kind = session.shell || 'bash';
  const spec = SHELLS[kind];
  const shellPath = findExecutable(kind, config.get('shellPaths', {})[kind]);
  if (process.platform === 'win32' && ['zsh', 'fish'].includes(kind)) throw new Error(`${kind} requires a WSL or Remote SSH window on Windows.`);
  const directory = store.runtimeDirectory(session.id);
  const script = path.join(store.root, spec.script);
  const integration = path.join(appRoot, 'out', 'vs', 'workbench', 'contrib', 'terminal', 'common', 'scripts', spec.integration);
  const fishName = `csr_${session.id.replaceAll('-', '_')}`;
  const historyFile = historyPath(session, store);
  let cwd = session.cwd;
  try { if (!fs.statSync(cwd).isDirectory()) cwd = os.homedir(); } catch { cwd = os.homedir(); }
  const env = {
    CSR_SESSION_ID: session.id, CSR_SESSION_DIR: directory, CSR_HISTORY_FILE: historyFile,
    CSR_HISTORY_SIZE: String(config.get('historySize', 20000)), CSR_BOOTSTRAP: script,
    CSR_STARTUP_MODE: config.get('startupMode', 'auto') === 'auto'
      ? (process.platform === 'darwin' ? 'login' : 'interactive') : config.get('startupMode'),
    CSR_INTEGRATION_SCRIPT: shellIntegration && fs.existsSync(integration) ? integration : ''
  };
  let shellArgs;
  if (kind === 'bash') {
    env.HISTFILE = historyFile;
    shellArgs = ['--init-file', script, '-i'];
  } else if (kind === 'zsh') {
    env.CSR_ORIGINAL_ZDOTDIR = process.env.ZDOTDIR || os.homedir();
    env.ZDOTDIR = script;
    env.HISTFILE = historyFile;
    shellArgs = env.CSR_STARTUP_MODE === 'login' ? ['-l', '-i'] : ['-i'];
  } else if (kind === 'fish') {
    env.fish_history = fishName;
    env.CSR_FISH_HISTORY = fishName;
    shellArgs = ['--interactive', '--init-command', 'source "$CSR_BOOTSTRAP"'];
    if (env.CSR_STARTUP_MODE === 'login') shellArgs.unshift('--login');
  } else {
    // Static script text is passed as one argument; no user data is interpolated.
    // This also avoids changing the machine's PowerShell execution policy.
    shellArgs = ['-NoLogo', '-NoExit', '-Command', fs.readFileSync(script, 'utf8')];
  }
  return { name: session.name, shellPath, shellArgs, cwd, isTransient: false, env };
}

module.exports = { SHELLS, findExecutable, installBootstraps, launchOptions, historyPath };
