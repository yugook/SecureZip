const { defineConfig } = require('@vscode/test-cli');

module.exports = defineConfig({
    files: 'out/test/extension.test.js',
    extensionDevelopmentPath: __dirname,
    launchArgs: ['--disable-gpu', '--disable-features=CalculateNativeWinOcclusion'],
    env: {
        DBUS_SESSION_BUS_ADDRESS: '/dev/null',
    },
});
