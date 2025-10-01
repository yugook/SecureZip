const { defineConfig } = require('@vscode/test-cli');
const fs = require('fs');
const os = require('os');
const path = require('path');

const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'securezip-ws-'));
fs.mkdirSync(workspaceRoot, { recursive: true });

module.exports = defineConfig({
    files: 'out/test/extension.test.js',
    extensionDevelopmentPath: __dirname,
    launchArgs: [
        '--disable-gpu',
        '--disable-features=CalculateNativeWinOcclusion',
        '--disable-dev-shm-usage',
        '--verbose',
        workspaceRoot,
    ],
    mocha: {
        timeout: 20000,
    },
    env: {
        NO_AT_BRIDGE: '1',
        SECUREZIP_TEST_WORKSPACE: workspaceRoot,
    },
});
