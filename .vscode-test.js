const { defineConfig } = require('@vscode/test-cli');
const fs = require('fs');
const path = require('path');

const workspaceDir = path.join(__dirname, 'tmp', 'test-workspace');
fs.mkdirSync(workspaceDir, { recursive: true });

module.exports = defineConfig({
    files: 'out/test/extension.test.js',
    extensionDevelopmentPath: __dirname,
    launchArgs: [
        workspaceDir,
        '--disable-gpu',
        '--disable-features=CalculateNativeWinOcclusion',
        '--disable-dev-shm-usage',
        '--verbose',
    ],
    mocha: {
        timeout: 20000,
    },
    env: {
        NO_AT_BRIDGE: '1',
    },
});
