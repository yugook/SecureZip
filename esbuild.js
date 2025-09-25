const esbuild = require("esbuild");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const watchLoggerPlugin = {
	name: 'esbuild-watch-logger',

	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[watch] build finished');
		});
	},
};

async function main() {
	const baseOptions = {
		entryPoints: [
			'src/extension.ts'
		],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		target: 'node20',
		outfile: 'dist/extension.js',
		external: ['vscode'],
		define: {
			// Build-time flags injected for tree-shaking and defaults.
			__BUILD_FLAGS__: JSON.stringify({
				// You can flip defaults per build here if needed.
			}),
			'process.env.NODE_ENV': production ? '"production"' : '"development"',
		},
		logLevel: 'silent',
		...(production ? { legalComments: 'none' } : {}),
	};

	if (watch) {
		const ctx = await esbuild.context({
			...baseOptions,
			plugins: [watchLoggerPlugin],
		});
		await ctx.watch();
		return;
	}

	await esbuild.build(baseOptions);
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
