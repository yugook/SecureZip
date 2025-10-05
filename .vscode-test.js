const { defineConfig } = require('@vscode/test-cli');
const fs = require('fs');
const os = require('os');
const path = require('path');

const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'securezip-test-'));

const launchArgs = [
    workspaceDir,
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
