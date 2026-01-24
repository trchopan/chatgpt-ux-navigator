export type AppConfig = {
    port: number;
    promptsDir: string;
    filesRoot: string;

    // If true, /responses will return a single JSON response (no SSE streaming),
    // regardless of request body `stream`.
    noStream: boolean;
};

export function makeConfig(partial: Partial<AppConfig>): AppConfig {
    return {
        port: partial.port ?? 8765,
        promptsDir: partial.promptsDir ?? process.cwd(),
        filesRoot: partial.filesRoot ?? process.cwd(),
        noStream: partial.noStream ?? false,
    };
}
