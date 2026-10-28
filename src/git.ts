import { simpleGit, SimpleGit } from 'simple-git';

export function createGit(baseDir: string): SimpleGit {
    return simpleGit({
        baseDir,
        // Identity values do not enable editors, pagers or alternate executable configuration.
        allowEnvironment: [
            'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_AUTHOR_DATE',
            'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'GIT_COMMITTER_DATE',
        ],
    });
}
