import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, it } from 'mocha';
import { createGit } from '../git';

describe('Git environment compatibility', () => {
    let root: string;
    beforeEach(async () => { root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'securezip-git-')); });
    afterEach(async () => { await fs.promises.rm(root, { recursive: true, force: true }); });

    it('preserves inherited author and committer identity for commits and annotated tags', async () => {
        const identity = {
            GIT_AUTHOR_NAME: 'SecureZip Author', GIT_AUTHOR_EMAIL: 'author@example.test',
            GIT_AUTHOR_DATE: '2026-10-20T00:00:00+00:00',
            GIT_COMMITTER_NAME: 'SecureZip Committer', GIT_COMMITTER_EMAIL: 'committer@example.test',
            GIT_COMMITTER_DATE: '2026-10-20T00:01:00+00:00',
        };
        const previous = Object.fromEntries(Object.keys(identity).map((key) => [key, process.env[key]]));
        Object.assign(process.env, identity);
        try {
            const git = createGit(root);
            await git.init();
            await git.addConfig('commit.gpgsign', 'false');
            await git.addConfig('tag.gpgsign', 'false');
            await git.commit('fixture', [], { '--allow-empty': null });
            await git.addAnnotatedTag('identity-test', 'fixture tag');
            assert.strictEqual((await git.raw(['log', '-1', '--format=%an|%ae|%cn|%ce|%at|%ct'])).trim(),
                `SecureZip Author|author@example.test|SecureZip Committer|committer@example.test|${Date.parse(identity.GIT_AUTHOR_DATE) / 1000}|${Date.parse(identity.GIT_COMMITTER_DATE) / 1000}`);
            assert.strictEqual((await git.raw(['for-each-ref', '--format=%(taggername)|%(taggeremail)', 'refs/tags/identity-test'])).trim(),
                'SecureZip Committer|<committer@example.test>');
        } finally {
            for (const [key, value] of Object.entries(previous)) {
                if (value === undefined) {
                    delete process.env[key];
                } else {
                    process.env[key] = value;
                }
            }
        }
    });

    it('still rejects editor injection and alternate executable configuration', async () => {
        for (const variable of ['VISUAL', 'GIT_CONFIG_GLOBAL', 'GIT_ASKPASS']) {
            await assert.rejects(
                createGit(root).env({ [variable]: 'securezip-must-not-run', TERM: 'xterm' }).raw(['var', 'GIT_EDITOR']),
                /unsafe|environment|not allowed/i,
            );
        }
        assert.strictEqual((await createGit(root).version()).installed, true);
    });
});
