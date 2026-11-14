'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const manifest = require('../package.json');
const vscePackage = require.resolve('@vscode/vsce/package.json');
const vsce = path.join(path.dirname(vscePackage), require(vscePackage).bin.vsce);
const output = path.join(root, 'dist', `${manifest.name}-${manifest.version}.vsix`);
fs.mkdirSync(path.dirname(output), { recursive: true });
const args = ['package', '--pre-release', '--out', output];
if (process.env.MARKETPLACE_BASE_IMAGES_URL) args.push('--baseImagesUrl', process.env.MARKETPLACE_BASE_IMAGES_URL);
if (process.env.MARKETPLACE_BASE_CONTENT_URL) args.push('--baseContentUrl', process.env.MARKETPLACE_BASE_CONTENT_URL);
const result = spawnSync(process.execPath, [vsce, ...args], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
