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
- **Entry Point**: `src/index.ts`.
- **Key Logic**:
    - **Prompt Parsing**: Reads `.md` files and resolves `@path` (single file), `@@path` (dir content), and directory trees. Located in `src/prompts/buildPrompt.ts`.
    - **Thread Parsing**: Splits prompts into `# {{USER}}` and `# {{ASSISTANT}}` blocks. Located in `src/prompts/thread.ts`.
    - **API**:
        - `GET /list`: Lists available prompt files.
        - `GET /prompt/:filename`: Returns processed prompt content.
        - `POST /prompt/:filename`: Appends assistant response to the file.
        - `POST /responses`: Streams assistant output using the current ChatGPT conversation (no forced reset).
        - `POST /responses/new`: Same as `/responses` but starts a temporary chat before injecting the prompt.
        - `GET /ws`: WebSocket endpoint for extension communication.

## Development Workflow

### Extension

- **Modifying Code**: Edit files in `extension/` directly.
- **Testing**: Go to `chrome://extensions`, find the extension, and click **Reload**. Refresh the ChatGPT tab to see changes.
- **Styling**: `extension/styles.css` handles sidebar appearance. It uses standard CSS variables for theming (often imitating ChatGPT's dark/light mode).

### Server

- **Running**: `cd server && bun run src/index.ts`
- **Dependencies**: managed via `bun install`.
- **Structure**:
    - `src/http/`: Server setup (`server.ts`), routing (`router.ts`), and route handlers (`routes/`).
    - `src/prompts/`: Core logic for parsing and building prompts.
    - `src/fs/`: File system utilities and security checks.
    - `src/ws/`: WebSocket logic.

## Code Conventions

- **Extension**:
    - Use **ES Modules** (`import`/`export`) for content scripts.
    - Avoid external libraries in the extension unless absolutely necessary to keep it lightweight and reviewable.
    - Use `document.querySelector` robustly as ChatGPT's DOM classes are obfuscated/dynamic. Prefer selector strategies that are less likely to break (e.g., `[data-message-author-role]`).
- **Server**:
    - **Modular & Declarative**: Prefer declarative code styles. The server uses a `Router` class for clear route definitions.
    - **Native APIs**: Use Bun native APIs (`Bun.file`, `Bun.write`, `Bun.serve`) over Node.js `fs` where possible.
    - **Formatting**: Code should be easy to read and documented where necessary.

## Common Tasks for Agents

- **"Fix the sidebar not appearing"**: Check `extension/content/bootstrap.js` or `observer.js`. The ChatGPT DOM might have changed.
- **"Add a new feature to the server"**:
    1.  Create a new handler in `server/src/http/routes/`.
    2.  Register it in `server/src/http/server.ts` using the router.
- **"Improve prompt parsing"**: Modify `server/src/prompts/buildPrompt.ts`. This handles the `@` syntax.
- **"Update extension styling"**: Check `extension/styles.css`. Ensure z-indices are high enough to sit above ChatGPT's UI but not block critical modals.
