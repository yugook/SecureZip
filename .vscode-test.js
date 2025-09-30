const { defineConfig } = require('@vscode/test-cli');

module.exports = defineConfig({
    files: 'out/test/extension.test.js',
    extensionDevelopmentPath: __dirname,
    launchArgs: ['--disable-gpu', '--disable-features=CalculateNativeWinOcclusion'],
    mocha: {
        timeout: 20000,
    },
    env: {
        DBUS_SESSION_BUS_ADDRESS: 'unix:path=/dev/null',
        NO_AT_BRIDGE: '1',
    },
});
