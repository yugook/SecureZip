import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { afterEach, beforeEach, describe, it } from 'mocha';
import { simpleGit } from 'simple-git';
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

    it('treats a POSIX filename-length error as a non-directory during expansion', async () => {
        const originalLstat = fs.promises.lstat;
        fs.promises.lstat = async () => {
            throw Object.assign(new Error('name too long'), { code: 'ENAMETOOLONG' });
        };
        try {
            assert.deepStrictEqual(await globFiles('missing-literal', { cwd: root }), []);
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
            (async () => {
                for (const pattern of patterns) {
                    await globFiles(pattern, { cwd: process.argv[2] });
                    await globFiles('**/*', { cwd: process.argv[2], ignore: [pattern] });
                    await globFiles(['**/*', '!' + pattern], { cwd: process.argv[2] });
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

    it('rejects explicit VISUAL editor injection while ordinary Git commands still work', async () => {
        await assert.rejects(
            simpleGit(root).env({ VISUAL: 'securezip-must-not-run', TERM: 'xterm' }).raw(['var', 'GIT_EDITOR']),
            /unsafe|VISUAL|environment/i,
        );
        const version = await simpleGit(root).version();
        assert.strictEqual(version.installed, true);
    });
});
