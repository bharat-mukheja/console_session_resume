'use strict';

const fs = require('node:fs');

function cleanText(text) {
  return text.replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g, '')
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').trim();
}

function parseHistory(text, shell) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (shell === 'fish') {
    return lines.filter(line => line.startsWith('- cmd: '))
      .map(line => cleanText(line.slice(7).replace(/\\(n|\\)/g, (_match, escape) => escape === 'n' ? '\n' : '\\'))).filter(Boolean);
  }
  const commands = [];
  let current = '';
  const timestamps = shell === 'bash' && lines.some(line => /^#\d+$/.test(line));
  const flush = () => { if (current.trim()) commands.push(current); current = ''; };
  for (const line of lines) {
    if (timestamps && /^#\d+$/.test(line)) { flush(); continue; }
    if (!line && !current) continue;
    if (timestamps) { current += `${current ? '\n' : ''}${line}`; continue; }
    const content = shell === 'zsh' ? line.replace(/^: \d+:\d+;/, '') : line;
    const continuation = (shell === 'pwsh' || shell === 'powershell') ? /`$/.test(content) : /\\$/.test(content);
    current += `${current ? '\n' : ''}${continuation ? content.slice(0, -1) : content}`;
    if (!continuation) flush();
  }
  flush();
  return commands.map(cleanText).filter(Boolean);
}

class HistoryPreview {
  constructor() { this.cache = new Map(); }

  read(file, shell) {
    try {
      const stat = fs.statSync(file);
      const key = `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}:${shell}`;
      const cached = this.cache.get(file);
      if (cached?.key === key) return cached.commands;
      const offset = Math.max(0, stat.size - 65536);
      const buffer = Buffer.alloc(Math.min(stat.size, 65536));
      const descriptor = fs.openSync(file, 'r');
      let bytes;
      try { bytes = fs.readSync(descriptor, buffer, 0, buffer.length, offset); }
      finally { fs.closeSync(descriptor); }
      let text = buffer.toString('utf8', 0, bytes);
      if (offset) text = text.includes('\n') ? text.slice(text.indexOf('\n') + 1) : '';
      const commands = parseHistory(text, shell).slice(-30);
      this.cache.set(file, { key, commands });
      return commands;
    } catch { return []; }
  }
}

module.exports = { HistoryPreview, parseHistory, cleanText };
