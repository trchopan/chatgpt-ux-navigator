import {resolve} from 'node:path';
import type {AppConfig} from './config';

export function parseArgv(argv: string[]): Partial<AppConfig> {
    const args = argv.slice(2);
    const config: Partial<AppConfig> = {};

    // Flags
    if (args.includes('--no-stream')) {
        config.noStream = true;
    }

    // Positional arguments (keep your existing behavior):
    // args[0] = promptsDir, args[1] = filesRoot
    // BUT: ignore flags in the positional slots
    const positionals = args.filter(a => !a.startsWith('--'));

    if (positionals[0]) {
        config.promptsDir = resolve(positionals[0]);
    }
    if (positionals[1]) {
        config.filesRoot = resolve(positionals[1]);
    }

    return config;
}
