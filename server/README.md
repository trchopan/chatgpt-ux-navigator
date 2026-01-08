# server

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.3.5. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

Below is a concise but thorough **documentation draft** you can place alongside the server (for example as `README.md` or `SERVER.md`). It is written to explain intent, behavior, and extension integration clearly.

---

## Prompt Assembly Server (Bun)

### Overview

This server exposes a single HTTP endpoint that dynamically assembles a prompt for ChatGPT from a Markdown source file.
The Markdown file supports **YAML front matter** that references additional files on the server’s filesystem. The server reads those files, concatenates their contents with the prompt body, and returns the final assembled prompt as plain text.

This design allows prompts to be:

- Declarative and reproducible
- Composed from multiple source files
- Easily updated without modifying browser extensions or client code

The server is intended to be consumed by a local browser extension or other local tooling.

---

### Endpoint

#### `GET /prompt`

Returns a fully assembled prompt as `text/plain`.

Example:

```text
Help me resolve the test error

--- /Users/johndoe/Documents/notes.md ---

<content of notes.md>

--- END OF /Users/johndoe/Documents/notes.md --
```

---

### Prompt Source File

#### Location

The prompt source is a Markdown file on disk.

By default:

- `./prompt.md` (relative to the server process)

Optionally overridden via environment variable:

```bash
PROMPT_MD_PATH=/absolute/path/to/prompt.md
```

---

### Markdown Format

#### Front Matter

The prompt file may begin with a YAML front matter section delimited by `+++`.

Currently supported keys:

| Key   | Type       | Description                                 |
| ----- | ---------- | ------------------------------------------- |
| files | `string[]` | List of file paths to include in the prompt |

Example:

```md
+++
files:
  - /Users/johndoe/Documents/notes.md
  - ./snippets/example.txt
+++

Help me resolve the test error
```

#### Body

Everything after the closing `+++` is treated as the **prompt body**.
This content always appears first in the assembled prompt.

---

### File Inclusion Behavior

For each entry in `files`:

- Absolute paths are used as-is
- Relative paths are resolved relative to the prompt Markdown file’s directory
- Files are read directly from the server’s filesystem
- Contents are appended in the order listed

Each file is appended using the following format:

```text
-- <absolute-path> --

<file contents>

---
```

If a file cannot be read, an error marker is inserted instead of failing the entire request.

---

### Assembly Algorithm (High-Level)

1. Read the prompt Markdown file
2. Parse YAML front matter (if present)
3. Extract the Markdown body
4. Resolve and read each referenced file
5. Assemble output in this order:
    1. Prompt body
    2. For each file:
        - File header
        - File contents
        - Separator (`---`)

6. Return the result as `text/plain` with preserved newlines

---

### Response Characteristics

- Content-Type: `text/plain; charset=utf-8`
- Newlines are preserved exactly (`\n`)
- No caching (`Cache-Control: no-store`)
- CORS enabled for local development

---

### Example Request

```bash
curl http://localhost:8765/prompt
```

---

### Intended Usage

This server is designed to work with:

- Browser extensions that inject prompts into ChatGPT
- Local automation workflows
- Prompt engineering setups that depend on source-controlled context files

It deliberately avoids:

- Authentication
- Remote file access
- Complex templating

The server is meant to be **local, explicit, and transparent**.

---

### Future Extension Points

The design allows for easy expansion, such as:

- Additional front matter keys (e.g. `title`, `role`, `system`)
- Conditional file inclusion
- Multiple prompt sources via query parameters
- Strict failure modes for missing files
- Caching with file mtime tracking

---

### Summary

This server provides a simple but powerful mechanism for assembling structured prompts from Markdown and filesystem context. It acts as a bridge between static prompt definitions and dynamic ChatGPT input, while remaining easy to reason about and debug.
