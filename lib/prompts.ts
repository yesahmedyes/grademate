import { readFile } from "node:fs/promises";
import path from "node:path";

// Prompt templates live in /prompts as editable Markdown. Files are read on every
// call (no caching) so edits take effect without restarting the server.
const PROMPTS_DIR = path.join(process.cwd(), "prompts");

/**
 * Load a prompt template by name (without extension) and fill {placeholders}.
 * Substitution is a single pass, so injected values are never re-scanned for
 * placeholders (safe when e.g. a marking scheme contains its own braces).
 */
export async function loadPrompt(
  name: string,
  vars: Record<string, string | number> = {}
): Promise<string> {
  const template = await readFile(path.join(PROMPTS_DIR, `${name}.md`), "utf8");
  return template
    .replace(/\{(\w+)\}/g, (whole, key: string) =>
      Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : whole
    )
    .trim();
}
