export type AppConfig = {
    port: number;
    promptsDir: string;
    filesRoot: string;
};

export function makeConfig(partial: Partial<AppConfig>): AppConfig {
    return {
        port: partial.port ?? 8765,
        promptsDir: partial.promptsDir ?? process.cwd(),
        filesRoot: partial.filesRoot ?? process.cwd(),
    };
}
