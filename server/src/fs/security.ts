import { resolve, relative, isAbsolute } from "node:path";

export function isPathInsideRoot(absPath: string, absRoot: string): boolean {
    const resolvedRoot = resolve(absRoot);
    const resolvedPath = resolve(absPath);
    
    const rel = relative(resolvedRoot, resolvedPath);
    
    // relative returns path from root to target
    // if target is inside root, it should not start with '..'
    // if target is outside root, it will start with '..'
    // on Windows if different drives, it returns absolute path
    
    return !rel.startsWith('..') && !isAbsolute(rel);
}
