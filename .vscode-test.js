const { defineConfig } = require('@vscode/test-cli');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'securezip-test-'));
const workspaceDir = path.join(testRoot, 'ws');
const userDataDir = path.join(testRoot, 'user-data');
const extensionsDir = path.join(testRoot, 'extensions');
const vscodeDir = path.join(workspaceDir, '.vscode');
const tasksFile = path.join(vscodeDir, 'tasks.json');

fs.mkdirSync(workspaceDir, { recursive: true });
fs.mkdirSync(userDataDir, { recursive: true });
fs.mkdirSync(extensionsDir, { recursive: true });
fs.mkdirSync(vscodeDir, { recursive: true });
if (!fs.existsSync(tasksFile)) {
    fs.writeFileSync(tasksFile, '{\n  "version": "2.0.0"\n}\n', 'utf8');
}

const launchArgs = [
    workspaceDir,
    `--user-data-dir=${userDataDir}`,
    `--extensions-dir=${extensionsDir}`,
    '--disable-gpu',
    '--disable-features=CalculateNativeWinOcclusion',
    '--disable-dev-shm-usage',
];

if (process.env.SECUREZIP_TEST_VERBOSE === '1') {
    launchArgs.push('--verbose');
}

module.exports = defineConfig({
    files: 'out/test/extension.test.js',
    extensionDevelopmentPath: __dirname,
    launchArgs,
    mocha: {
        timeout: 20000,
        jobs: 1,
    },
    env: {
        NO_AT_BRIDGE: '1',
        VSCODE_LOG_LEVEL: process.env.SECUREZIP_TEST_VERBOSE === '1' ? 'info' : 'warn',
        SECUREZIP_TEST_ROOT: workspaceDir,
    },
});
