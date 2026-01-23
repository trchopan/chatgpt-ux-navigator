# AI Agent Guide for ChatGPT UX Navigator

This file provides context and guidelines for AI agents working on this codebase.

## Project Overview

**ChatGPT UX Navigator** is a dual-component tool designed to enhance the ChatGPT experience for power users.

1.  **Browser Extension**: A Chrome extension (Manifest V3) that injects a sticky sidebar into the ChatGPT interface for navigation, prompt injection, and response saving.
2.  **Local Server**: A lightweight HTTP server built with [Bun](https://bun.sh) that serves local Markdown prompts and handles file inclusions (`@path`).

## Architecture & Stack

### 1. Browser Extension (`extension/`)

- **Tech**: Vanilla JavaScript (ES Modules), CSS3, HTML.
- **Build**: **NO BUILD STEP.** The code runs directly in the browser.
- **Manifest**: V3 (`manifest.json`).
- **Key Files**:
    - `content/bootstrap.js`: Entry point for content scripts.
    - `content/sidebar.js`: Manages the sidebar UI creation and updates.
    - `content/observer.js`: MutationObserver to detect new ChatGPT messages.
    - `content/messaging.js`: Handles communication with the local server.
    - `content/markdown.js`: Handles markdown parsing/rendering within the sidebar if needed.
    - `background.js`: Service worker (minimal logic).

### 2. Local Server (`server/`)

- **Tech**: TypeScript, [Bun](https://bun.sh).
- **Build**: No transpilation needed for development; Bun runs TS natively.
- **Entry Point**: `index.ts`.
- **Key Logic**:
    - **Prompt Parsing**: Reads `.md` files and resolves `@path` (single file), `@@path` (dir content), and directory trees.
    - **Thread Parsing**: Splits prompts into `# {{USER}}` and `# {{ASSISTANT}}` blocks.
    - **API**:
        - `GET /list`: Lists available prompt files.
        - `GET /prompt/:filename`: Returns processed prompt content.
        - `POST /prompt/:filename`: Appends assistant response to the file.

## Development Workflow

### Extension

- **Modifying Code**: Edit files in `extension/` directly.
- **Testing**: Go to `chrome://extensions`, find the extension, and click **Reload**. Refresh the ChatGPT tab to see changes.
- **Styling**: `extension/styles.css` handles sidebar appearance. It uses standard CSS variables for theming (often imitating ChatGPT's dark/light mode).

### Server

- **Running**: `cd server && bun run index.ts`
- **Dependencies**: managed via `bun install`.
- **Logic**: The server logic is contained entirely within `server/index.ts` for simplicity. If it grows, refactor into modules.

## Code Conventions

- **Extension**:
    - Use **ES Modules** (`import`/`export`) for content scripts.
    - Avoid external libraries in the extension unless absolutely necessary to keep it lightweight and reviewable.
    - Use `document.querySelector` robustly as ChatGPT's DOM classes are obfuscated/dynamic. Prefer selector strategies that are less likely to break (e.g., `[data-message-author-role]`).
- **Server**:
    - Use Bun native APIs (`Bun.file`, `Bun.write`, `Bun.serve`) over Node.js `fs` where possible (though `node:path` and `node:fs/promises` are used for compatibility/specific needs).
    - Keep it simple. It's a single-file server for now.

## Common Tasks for Agents

- **"Fix the sidebar not appearing"**: Check `extension/content/bootstrap.js` or `observer.js`. The ChatGPT DOM might have changed.
- **"Add a new feature to the server"**: Modify `server/index.ts`. Remember to handle CORS headers manually as done in the existing `fetch` handler.
- **"Improve prompt parsing"**: Look at `buildPrompt` in `server/index.ts`. This handles the `@` syntax.
- **"Update extension styling"**: Check `extension/styles.css`. Ensure z-indices are high enough to sit above ChatGPT's UI but not block critical modals.
