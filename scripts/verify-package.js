'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');

// Read the ZIP central directory with the ZIP library used by the official packager.
async function main() {
  const manifest = require('../package.json');
  const file = path.resolve(__dirname, '..', 'dist', `${manifest.name}-${manifest.version}.vsix`);
  const yauzl = require('yauzl');
  const zip = await promisify(yauzl.open)(file, { lazyEntries: true });
  const names = [];
  const contents = new Map();
  await new Promise((resolve, reject) => {
    zip.on('error', reject);
    zip.on('end', resolve);
    zip.on('entry', entry => {
      names.push(entry.fileName);
      if (/^extension\/(package\.json|readme\.md)$/.test(entry.fileName) || entry.fileName === 'extension.vsixmanifest') {
        zip.openReadStream(entry, (error, stream) => {
          if (error) return reject(error);
          const chunks = [];
          stream.on('data', chunk => chunks.push(chunk));
          stream.on('error', reject);
          stream.on('end', () => { contents.set(entry.fileName, Buffer.concat(chunks).toString('utf8')); zip.readEntry(); });
        });
      } else zip.readEntry();
    });
    zip.readEntry();
  });
  const shipped = JSON.parse(contents.get('extension/package.json'));
  assert.equal(shipped.publisher, 'bmukheja');
  assert.equal(shipped.name, 'console-session-resume');
  for (const required of ['extension/src/extension.js', 'extension/shell/zsh/.zshenv', 'extension/shell/zsh/.zshrc',
    'extension/shell/bootstrap.bash', 'extension/shell/bootstrap.ps1', 'extension/shell/bootstrap.fish', 'extension/images/icon-256.png',
    'extension/images/screenshots/saved-terminals.jpg', 'extension/images/screenshots/resume-picker.jpg', 'extension/images/screenshots/command-preview.jpg',
    'extension/PRIVACY.md', 'extension/SUPPORT.md', 'extension/changelog.md', 'extension/LICENSE.txt']) {
    assert.ok(names.includes(required), `Missing runtime file: ${required}`);
  }
  assert.ok(!names.some(name => /\/node_modules\/|\/\.test-work\/|\/test\/|\/scripts\/|\/\.git\//.test(name)), 'Development or private test files leaked into the VSIX');
  assert.ok(contents.get('extension.vsixmanifest').includes('Microsoft.VisualStudio.Code.PreRelease'));
  assert.ok(contents.get('extension.vsixmanifest').includes('Microsoft.VisualStudio.Services.Icons.Default'));
  const icon = fs.readFileSync(path.resolve(__dirname, '..', shipped.icon));
  assert.equal(icon.subarray(1, 4).toString(), 'PNG');
  assert.ok(icon.readUInt32BE(16) >= 128 && icon.readUInt32BE(20) >= 128);
  if (process.argv.includes('--check-links')) {
    const readme = contents.get('extension/readme.md');
    const imageURLs = [...readme.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map(match => match[1]);
    assert.ok(imageURLs.length >= 4, 'README must reference the icon and three screenshots');
    for (const url of imageURLs) {
      assert.ok(url.startsWith('https://'), 'Listing images must use HTTPS');
      const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
      await response.body?.cancel();
      assert.ok(response.ok && response.headers.get('content-type')?.startsWith('image/'), `Public image is unavailable: ${url}`);
    }
    console.log('Verified all listing images load anonymously over HTTPS.');
  }
  console.log(`Verified ${names.length} package entries, ${shipped.publisher}.${shipped.name} ${shipped.version}, PNG icon, hidden Zsh startup files, and development-file exclusions.`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
