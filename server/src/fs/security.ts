export function isPathInsideRoot(absPath: string, absRoot: string): boolean {
    const root = absRoot.endsWith('/') || absRoot.endsWith('\\') ? absRoot : absRoot + '/';
    const path = absPath.replace(/\\/g, '/');
    const normRoot = root.replace(/\\/g, '/');
    return path === normRoot.slice(0, -1) || path.startsWith(normRoot);
}
