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
const child = npmCli
  ? spawnSync(process.execPath, [npmCli, ...args], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    })
  : spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
      cwd: repoRoot,
      encoding: 'utf8',
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
