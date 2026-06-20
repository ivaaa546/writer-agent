import { readFileSync } from "node:fs";
import mammoth from "mammoth";
import type { ParsedDocument } from "./index.js";

export async function readDocx(filePath: string): Promise<ParsedDocument> {
  const buffer = readFileSync(filePath);
  const result = await mammoth.extractRawText({ buffer });
  return {
    text: result.value,
    metadata: { warnings: result.messages },
  };
}
