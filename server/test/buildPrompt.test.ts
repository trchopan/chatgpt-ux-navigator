import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { buildPrompt } from "../src/prompts/buildPrompt";

const TEST_ROOT = join(import.meta.dir, "temp_test_root");
const PROMPTS_ROOT = join(TEST_ROOT, "prompts");
const FILES_ROOT = join(TEST_ROOT, "files");

describe("buildPrompt", () => {
  beforeEach(async () => {
    // Clean up before starting to ensure clean state
    await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(PROMPTS_ROOT, { recursive: true });
    await mkdir(FILES_ROOT, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it("should return simple content without imports", async () => {
    const promptPath = join(PROMPTS_ROOT, "simple.md");
    await writeFile(promptPath, "Hello World");
    
    const result = await buildPrompt(promptPath, FILES_ROOT);
    expect(result).toBe("Hello World\n");
  });

  it("should include a file using @path", async () => {
    const promptPath = join(PROMPTS_ROOT, "with_import.md");
    const includedPath = join(FILES_ROOT, "snippet.txt");
    
    await writeFile(promptPath, "Start\n@snippet.txt\nEnd");
    await writeFile(includedPath, "Snippet Content");

    const result = await buildPrompt(promptPath, FILES_ROOT);
    
    expect(result).toContain("Start");
    expect(result).toContain("Snippet Content");
    expect(result).toContain("End");
    expect(result).toContain("**File:** snippet.txt");
  });

  it("should list directory tree using @dir", async () => {
    const promptPath = join(PROMPTS_ROOT, "tree.md");
    const subDir = join(FILES_ROOT, "subdir");
    await mkdir(subDir);
    await writeFile(join(subDir, "file1.txt"), "c1");
    await writeFile(join(subDir, "file2.txt"), "c2");

    await writeFile(promptPath, "@subdir");

    const result = await buildPrompt(promptPath, FILES_ROOT);
    
    expect(result).toContain("subdir");
    expect(result).toContain("file1.txt");
    expect(result).toContain("file2.txt");
    expect(result).not.toContain("c1"); // Content shouldn't be there
  });

  it("should concatenate directory files using @@dir", async () => {
    const promptPath = join(PROMPTS_ROOT, "concat.md");
    const subDir = join(FILES_ROOT, "subdir_concat");
    await mkdir(subDir);
    await writeFile(join(subDir, "a.txt"), "Content A");
    await writeFile(join(subDir, "b.txt"), "Content B");

    await writeFile(promptPath, "@@subdir_concat");

    const result = await buildPrompt(promptPath, FILES_ROOT);
    
    expect(result).toContain("Content A");
    expect(result).toContain("Content B");
  });

  it("should handle nested paths and relative imports correctly", async () => {
      const promptPath = join(PROMPTS_ROOT, "nested.md");
      const subDir = join(FILES_ROOT, "deep/nested");
      await mkdir(subDir, { recursive: true });
      await writeFile(join(subDir, "deep.txt"), "Deep Content");

      await writeFile(promptPath, "@deep/nested/deep.txt");

      const result = await buildPrompt(promptPath, FILES_ROOT);
      expect(result).toContain("Deep Content");
  });

  it("should prevent accessing files outside root", async () => {
     const promptPath = join(PROMPTS_ROOT, "security.md");
     await writeFile(promptPath, "@../secret.txt");
     
     // Create a file outside FILES_ROOT but inside TEST_ROOT
     // Note: ../secret.txt from FILES_ROOT resolves to TEST_ROOT/secret.txt
     await writeFile(join(TEST_ROOT, "secret.txt"), "Secret!");

     const result = await buildPrompt(promptPath, FILES_ROOT);
     
     expect(result).toContain("[ERROR: Path escapes FILES_ROOT");
     expect(result).not.toContain("Secret!");
  });
});
