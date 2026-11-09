'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function processStart(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return undefined;
  try {
    if (process.platform === 'win32') {
      const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      return execFileSync(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
        `(Get-Process -Id ${pid}).StartTime.ToUniversalTime().Ticks.ToString()`], { encoding: 'utf8', timeout: 3000, windowsHide: true }).trim();
    }
    return execFileSync('/bin/ps', ['-p', String(pid), '-o', 'lstart='], {
      encoding: 'utf8', timeout: 1000, env: { ...process.env, LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch { return undefined; }
}

async function identifyTerminal(terminal, store, workspace, fingerprint = processStart) {
  const supplied = terminal.creationOptions.env?.CSR_SESSION_ID;
  if (supplied) return supplied;
  // VS Code revives the launch environment correctly but omits it from the public
  // creationOptions API. Match both PID and process birth time, never names or PID alone.
  const pid = await terminal.processId;
  const started = fingerprint(pid);
  if (!started) return undefined;
  for (const session of store.list(workspace)) {
    try {
      const [recordedPid, recordedStart] = fs.readFileSync(path.join(store.directory(session.id), 'process'), 'utf8').trim().split(/\r?\n/);
      if (recordedPid === String(pid) && recordedStart.trim() === started) return session.id;
    } catch { /* No live-process record for this saved session. */ }
  }
  return undefined;
}

module.exports = { identifyTerminal };
