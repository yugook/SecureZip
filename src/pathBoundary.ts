import * as fs from 'fs';
import * as path from 'path';

export function isPathWithin(root: string, candidate: string): boolean {
    const relative = path.relative(path.resolve(root), path.resolve(candidate));
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export async function isRealPathWithin(root: string, candidate: string): Promise<boolean> {
    return isPathWithin(root, candidate) && isPathWithin(
        await fs.promises.realpath(root), await fs.promises.realpath(candidate),
    );
}
