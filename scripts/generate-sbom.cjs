#!/usr/bin/env node

/**
 * Generates a CycloneDX SBOM using `npm sbom` and writes it to dist/.
 */

const { spawnSync } = require('node:child_process');
const { mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const distDir = path.join(repoRoot, 'dist');
const outputFile = path.join(distDir, 'securezip-sbom.cdx.json');
const pinnedNpmVersion = '10.9.0';

mkdirSync(distDir, { recursive: true });

const args = [
  'sbom',
  '--sbom-format',
  'cyclonedx',
  '--sbom-type',
  'application',
  '--omit',
  'dev',
  '--package-lock-only',
];

const npmCli = process.env.npm_execpath;
const npmCommand = npmCli
  ? { command: process.execPath, args: [npmCli] }
  : { command: process.platform === 'win32' ? 'npm.cmd' : 'npm', args: [] };

function spawnNpm(args, options) {
  return spawnSync(npmCommand.command, [...npmCommand.args, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    ...options,
  });
}

const versionCheck = spawnNpm(['--version'], {
  stdio: ['ignore', 'pipe', 'inherit'],
});

if (versionCheck.error) {
  throw versionCheck.error;
}

if (versionCheck.status !== 0) {
  throw new Error(`npm --version exited with code ${versionCheck.status}`);
}

const actualNpmVersion = versionCheck.stdout.trim();
if (actualNpmVersion !== pinnedNpmVersion) {
  throw new Error(
    `SBOM generation requires npm ${pinnedNpmVersion}; found npm ${actualNpmVersion}. Run "npm install -g npm@${pinnedNpmVersion}" before packaging.`,
  );
}

const child = spawnNpm(args, {
  stdio: ['ignore', 'pipe', 'inherit'],
});

if (child.error) {
  throw child.error;
}

if (child.status !== 0) {
  throw new Error(`npm sbom exited with code ${child.status}`);
}

writeFileSync(outputFile, child.stdout, 'utf8');
console.log(`SBOM written to ${path.relative(repoRoot, outputFile)}`);
