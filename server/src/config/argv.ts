import { resolve } from 'node:path';
import type { AppConfig } from './config';

export function parseArgv(argv: string[]): Partial<AppConfig> {
    const args = argv.slice(2);
    const config: Partial<AppConfig> = {};

    if (args[0]) {
        config.promptsDir = resolve(args[0]);
    }
    if (args[1]) {
        config.filesRoot = resolve(args[1]);
    }

    return config;
}
