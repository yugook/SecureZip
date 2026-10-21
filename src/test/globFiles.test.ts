import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { afterEach, beforeEach, describe, it } from 'mocha';
import { globFiles, globFileStream } from '../globFiles';

const execFileAsync = promisify(execFile);

describe('secure file globbing', () => {
    let root: string;

    beforeEach(async () => {
        root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'securezip-glob-'));
    });

    afterEach(async () => {
        await fs.promises.rm(root, { recursive: true, force: true });
    });

    const write = async (relative: string, content = ''): Promise<void> => {
        const file = path.join(root, relative);
        await fs.promises.mkdir(path.dirname(file), { recursive: true });
        await fs.promises.writeFile(file, content);
    };

    it('preserves dotfiles, brace patterns, absolute paths and duplicate elimination', async () => {
        await write('.visible');
        await write('src/a.ts');
        await write('src/b.js');
        await write('src/c.log');
        const files = await globFiles(['**/*.{ts,js}', '**/*.ts', '**/.*'], {
            cwd: root, dot: true, absolute: true,
        });
        assert.deepStrictEqual(files.sort(), ['.visible', 'src/a.ts', 'src/b.js'].map((file) => path.join(root, file)).sort());
    });

    it('applies nested Git ignore rules and re-inclusions independently of glob exclusions', async () => {
        await write('.gitignore', '*.log\nblocked/\n');
        await write('nested/.gitignore', '!keep.log\n/local.txt\n');
        for (const file of ['drop.log', 'nested/drop.log', 'nested/keep.log', 'nested/local.txt', 'local.txt', 'blocked/a.txt']) {
            await write(file);
        }
        const files = await globFiles('**/*', { cwd: root, dot: true, gitignore: true, ignore: ['**/.gitignore'] });
        assert.deepStrictEqual(files.sort(), ['local.txt', 'nested/keep.log']);
        assert.deepStrictEqual(await globFiles('blocked/a.txt', { cwd: root, gitignore: false }), ['blocked/a.txt']);
    });

    it('does not let a child Git ignore file rescue an excluded parent directory', async () => {
        await write('.gitignore', 'blocked/\n');
        await write('blocked/.gitignore', '!keep.txt\n');
        await write('blocked/keep.txt');
        assert.deepStrictEqual(await globFiles('blocked/keep.txt', { cwd: root, gitignore: true }), []);
    });

    it('honors parent Git rules when the workspace is below the repository root', async () => {
        await fs.promises.mkdir(path.join(root, '.git'));
        await write('.gitignore', '/nested/drop.txt\n/other/\n');
        await write('nested/drop.txt');
        await write('nested/keep.txt');
        assert.deepStrictEqual(await globFiles('**/*', { cwd: path.join(root, 'nested'), gitignore: true }), ['keep.txt']);
    });

    it('handles Windows path casing when applying Git ignore rules', async function () {
        if (process.platform !== 'win32') {
            this.skip();
        }
        await write('.gitignore', 'drop.txt\n');
        await write('drop.txt');
        await write('keep.txt');
        assert.deepStrictEqual(await globFiles('**/*', { cwd: root.toUpperCase(), gitignore: true }), ['keep.txt']);
    });

    it('keeps Git ignore metacharacters literal and supports escaped comment/negation prefixes', async () => {
        await write('.gitignore', 'literal{a,b}.txt\n\\#secret\n\\!secret\n');
        for (const file of ['literal{a,b}.txt', 'literala.txt', '#secret', '!secret']) {
            await write(file);
        }
        assert.deepStrictEqual(await globFiles('**/*', { cwd: root, gitignore: true }), ['literala.txt']);
    });

    it('preserves directory expansion, negative patterns and shallow directory searches', async () => {
        await write('src/a.txt');
        await write('src/nested/b.txt');
        await write('src/nested/deeper/c.txt');
        assert.deepStrictEqual(await globFiles(['src', '!src/nested'], { cwd: root }), ['src/a.txt']);
        const directories = await globFiles('**/*', { cwd: root, onlyDirectories: true, deep: 2 });
        assert.deepStrictEqual(directories.sort(), ['src', 'src/nested']);
    });

    it('includes extensionless files as well as descendants of recursively named directories', async () => {
        await write('LICENSE');
        await write('nested/LICENSE');
        await write('other/LICENSE/notice.txt');
        assert.deepStrictEqual((await globFiles('**/LICENSE', { cwd: root })).sort(), [
            'LICENSE', 'nested/LICENSE', 'other/LICENSE/notice.txt',
        ]);
        assert.deepStrictEqual(await globFiles('**/*', { cwd: root, ignore: ['**/LICENSE'] }), []);
    });

    it('re-includes dotted hidden directories and retains matching files', async () => {
        await write('.gitignore', '**/.config.json/\n');
        await write('.config.json');
        await write('nested/.config.json/file.txt');
        await write('nested/.config.json/deeper/child.txt');
        await write('nested/config.json');
        const options = { cwd: root, dot: true };
        const descendants = ['nested/.config.json/deeper/child.txt', 'nested/.config.json/file.txt'];
        const base = await globFiles('**/*', { ...options, gitignore: true, ignore: ['**/.gitignore'] });
        assert.deepStrictEqual(base.sort(), ['.config.json', 'nested/config.json']);
        const included = await globFiles('**/.config.json', { ...options, gitignore: false });
        assert.deepStrictEqual(included.sort(), ['.config.json', ...descendants]);
        assert.deepStrictEqual(await globFiles('**/config.json', options), ['nested/config.json']);
        for (const files of [
            await globFiles('**/*', { ...options, ignore: ['**/.config.json', '**/.gitignore'] }),
            await globFiles(['**/*', '!**/.config.json', '!**/.gitignore'], options),
        ]) {
            assert.deepStrictEqual(files, ['nested/config.json']);
        }
    });

    it('recursively excludes ordinary dotted directories without losing same-name file matches', async () => {
        for (const name of ['cache.v1', 'cache.v1.tar.gz']) {
            await write(name);
            await write(`nested/${name}/private.txt`);
            await write(`nested/${name}/deeper/private.key`);
        }
        await write('nested/cache.v2/keep.txt');
        const options = { cwd: root, dot: true };
        const patterns = ['**/cache.v1', '**/cache.v1.tar.gz'];
        for (const excluded of [patterns, ['**/cache.v1*']]) {
            assert.deepStrictEqual(await globFiles('**/*', { ...options, ignore: excluded }), ['nested/cache.v2/keep.txt']);
            assert.deepStrictEqual(await globFiles(['**/*', ...excluded.map((pattern) => `!${pattern}`)], options), ['nested/cache.v2/keep.txt']);
            assert.deepStrictEqual(await globFiles('nested/cache.v1/private.txt', { ...options, ignore: excluded }), []);
        }
        assert.deepStrictEqual((await globFiles('**/cache.v1', options)).sort(), [
            'cache.v1', 'nested/cache.v1/deeper/private.key', 'nested/cache.v1/private.txt',
        ]);
        assert.deepStrictEqual((await globFiles('nested/**/cache.v1', options)).sort(), [
            'nested/cache.v1/deeper/private.key', 'nested/cache.v1/private.txt',
        ]);
    });

    it('distinguishes negated extglobs from negative patterns', async () => {
        await write('README.md');
        await write('LICENSE');
        await write('index.js');
        assert.deepStrictEqual((await globFiles('!(README.md)', { cwd: root })).sort(), ['LICENSE', 'index.js']);
        assert.deepStrictEqual(await globFiles(['!(*.js)', '!README.md'], { cwd: root }), ['LICENSE']);
    });

    it('does not traverse symbolic-link directories, including explicit paths', async () => {
        await write('target/private.txt');
        await fs.promises.symlink(path.join(root, 'target'), path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
        const files = await globFiles('**/*', { cwd: root, followSymbolicLinks: false });
        assert.deepStrictEqual(files, ['target/private.txt']);
        assert.deepStrictEqual(await globFiles('linked/private.txt', { cwd: root, followSymbolicLinks: false }), []);
    });

    it('restricts export searches to their selected root while preserving ordinary glob traversal by default', async () => {
        await write('project/keep.txt');
        await write('project/..notes.txt');
        await write('project-other/private.txt');
        const cwd = path.join(root, 'project');
        const outside = path.join(root, 'project-other');
        await fs.promises.symlink(outside, path.join(cwd, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
        const options = { cwd, dot: true, restrictToCwd: true };
        const originalLstat = fs.promises.lstat;
        fs.promises.lstat = (async (file: fs.PathLike) => {
            assert.ok(!String(file).includes('project-other'), 'Outside search paths must not be probed');
            return originalLstat(file);
        }) as typeof fs.promises.lstat;
        try {
            for (const pattern of [
                '../project-other/private.txt', './../project-other/**', '../{project-other,missing}/private.txt',
                '../project-other/@(private|missing).txt', `${outside.split(path.sep).join('/')}/private.txt`, 'linked/**',
            ]) {
                assert.deepStrictEqual(await globFiles(['keep.txt', pattern], options), ['keep.txt'], pattern);
            }
        } finally {
            fs.promises.lstat = originalLstat;
        }
        assert.deepStrictEqual((await globFiles(['**/*', 'keep.txt'], options)).sort(), ['..notes.txt', 'keep.txt']);
        assert.deepStrictEqual(await globFiles('../project/keep.txt', options), ['keep.txt']);
        assert.deepStrictEqual(await globFiles('../project-other/private.txt', { cwd }), ['../project-other/private.txt']);
        const originalRealpath = fs.promises.realpath;
        fs.promises.realpath = (async (file: fs.PathLike) => path.relative(path.join(cwd, 'keep.txt'), String(file)) === ''
            ? path.join(outside, 'private.txt') : originalRealpath(file)) as typeof fs.promises.realpath;
        try {
            assert.deepStrictEqual(await globFiles('keep.txt', options), [], 'Canonical targets outside the root must be excluded');
        } finally {
            fs.promises.realpath = originalRealpath;
        }
    });

    it('allows preview consumers to stop a stream after one match', async () => {
        for (let index = 0; index < 12; index++) {
            await write(`dir-${index}/file.txt`);
        }
        let count = 0;
        for await (const file of globFileStream('**/*', { cwd: root })) {
            assert.ok(file.endsWith('file.txt'));
            count++;
            break;
        }
        assert.strictEqual(count, 1);
    });

    it('finishes missing nested re-includes and previews without an unhandled error', async () => {
        for (const gitignore of [false, true]) {
            assert.deepStrictEqual(await globFiles('missing/parent/file.txt', { cwd: root, gitignore }), []);
        }
    });

    it('rejects a directory named .gitignore instead of leaving the stream pending', async () => {
        await write('sub/.gitignore/entry.txt');
        await assert.rejects(globFiles('**/*', { cwd: root, dot: true, gitignore: true }), { code: 'EISDIR' });
    });

    it('propagates Git ignore read errors with their original cause', async () => {
        await write('sub/file.txt');
        const original = fs.promises.readFile;
        const denied = Object.assign(new Error('gitignore denied'), { code: 'EACCES' });
        fs.promises.readFile = (async (file: fs.PathLike) => {
            if (path.basename(String(file)) === '.gitignore') {
                throw denied;
            }
            return original(file);
        }) as typeof fs.promises.readFile;
        try {
            await assert.rejects(globFiles('**/*', { cwd: root, gitignore: true }), (error) => error === denied);
        } finally {
            fs.promises.readFile = original;
        }
    });

    it('rejects unreadable directory contents instead of exporting an incomplete result', async () => {
        await write('blocked/private.txt');
        const original = fs.promises.readdir;
        for (const code of ['EACCES', 'ENAMETOOLONG', 'ELOOP', 'EIO']) {
            const denied = Object.assign(new Error('directory read failed'), { code });
            fs.promises.readdir = (async (directory: fs.PathLike, options: unknown) => {
                if (path.relative(path.join(root, 'blocked'), String(directory)) === '') {
                    throw denied;
                }
                return original(directory, options as { withFileTypes: true });
            }) as typeof fs.promises.readdir;
            try {
                await assert.rejects(globFiles('**/*', { cwd: root }), (error) => error === denied);
            } finally {
                fs.promises.readdir = original;
            }
        }
        assert.deepStrictEqual(await globFiles('**/*', { cwd: root }), ['blocked/private.txt']);
    });

    it('propagates stat errors that the glob backend would otherwise suppress', async () => {
        await write('keep.txt');
        const original = fs.promises.lstat;
        for (const code of ['EACCES', 'ENAMETOOLONG']) {
            const denied = Object.assign(new Error('stat failed'), { code });
            fs.promises.lstat = (async (file: fs.PathLike) => {
                if (path.relative(root, String(file)) === '') {
                    throw denied;
                }
                return original(file);
            }) as typeof fs.promises.lstat;
            try {
                await assert.rejects(globFiles('**/*', { cwd: root }), (error) => error === denied);
            } finally {
                fs.promises.lstat = original;
            }
        }
    });

    it('does not perform synchronous filesystem I/O while walking and reading Git rules', async () => {
        await write('.gitignore', 'drop.txt\n');
        await write('drop.txt');
        await write('nested/keep.txt');
        const originals = { lstatSync: fs.lstatSync, readFileSync: fs.readFileSync, existsSync: fs.existsSync };
        const nativeFs: typeof fs = require('fs');
        const unexpected = (): never => { throw new Error('unexpected synchronous I/O'); };
        Object.assign(nativeFs, { lstatSync: unexpected, readFileSync: unexpected, existsSync: unexpected });
        try {
            assert.deepStrictEqual(await globFiles('**/*', { cwd: root, gitignore: true }), ['nested/keep.txt']);
        } finally {
            Object.assign(nativeFs, originals);
        }
    });

    it('counts depth from each static pattern base, including mixed and brace-expanded bases', async () => {
        for (const file of ['root.log', 'one/child.log', 'one/two/deep.log', 'x/y/root.log', 'x/y/one/child.log', 'x/y/one/two/deep.log']) {
            await write(file);
        }
        assert.deepStrictEqual((await globFiles(['**/*.log', 'x/y/**/*.log'], { cwd: root, deep: 1 })).sort(), ['root.log', 'x/y/root.log']);
        assert.deepStrictEqual((await globFiles('{x/y,one}/**/*.log', { cwd: root, deep: 1 })).sort(), ['one/child.log', 'x/y/root.log']);
        for (const pattern of ['./x/y/**/*.log', `${root.split(path.sep).join('/')}/x/y/**/*.log`, 'x/y']) {
            assert.deepStrictEqual(await globFiles(pattern, { cwd: root, deep: 1 }), ['x/y/root.log']);
        }
        assert.deepStrictEqual(await globFiles('../one/**/*.log', { cwd: path.join(root, 'x'), deep: 1 }), ['../one/child.log']);
        assert.deepStrictEqual(await globFiles('@(x|one)/**/*.log', { cwd: root, deep: 2 }), ['one/child.log']);
    });

    it('reports filename-length failures when a literal search reaches the filesystem', async () => {
        const originalLstat = fs.promises.lstat;
        fs.promises.lstat = (async (file: fs.PathLike) => {
            if (path.basename(String(file)) === 'missing-literal') {
                throw Object.assign(new Error('name too long'), { code: 'ENAMETOOLONG' });
            }
            return originalLstat(file);
        }) as typeof fs.promises.lstat;
        try {
            await assert.rejects(globFiles('missing-literal', { cwd: root }), { code: 'ENAMETOOLONG' });
        } finally {
            fs.promises.lstat = originalLstat;
        }
    });

    it('propagates directory-probe permission errors', async () => {
        const originalLstat = fs.promises.lstat;
        const denied = Object.assign(new Error('permission denied'), { code: 'EACCES' });
        fs.promises.lstat = async () => { throw denied; };
        try {
            await assert.rejects(globFiles('unreadable', { cwd: root }), denied);
        } finally {
            fs.promises.lstat = originalLstat;
        }
    });

    it('bounds nested, comma-chain and quadratic brace payloads without crashing the process', async function () {
        this.timeout(10000);
        const source = `
            const { globFiles } = require(process.argv[1]);
            const patterns = [
                '{'.repeat(3200) + 'a,b' + '}'.repeat(3200),
                '{' + 'a,'.repeat(15000) + 'b}',
                '{a}' + '}'.repeat(32000) + ',z}',
            ];
            const run = async (operation) => {
                try {
                    await operation();
                } catch (error) {
                    // POSIX may reject a literalized payload at its filename limit; that error must be catchable.
                    if (error.code !== 'ENAMETOOLONG') throw error;
                }
            };
            (async () => {
                for (const pattern of patterns) {
                    await run(() => globFiles(pattern, { cwd: process.argv[2] }));
                    await run(() => globFiles('**/*', { cwd: process.argv[2], ignore: [pattern] }));
                    await run(() => globFiles(['**/*', '!' + pattern], { cwd: process.argv[2] }));
                }
                console.log('bounded');
            })().catch(error => { console.error(error); process.exitCode = 1; });
        `;
        // An empty value disables Node's automatic propagation of V8 coverage to this timing probe.
        const workerEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_V8_COVERAGE: '' };
        const { stdout } = await execFileAsync(process.execPath, ['-e', source, require.resolve('../globFiles'), root], {
            timeout: 8000,
            env: workerEnv,
        });
        assert.match(stdout, /bounded/);
    });

});
