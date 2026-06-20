import { readFileSync } from "node:fs";
import type { ParsedDocument } from "./index.js";

export function readText(filePath: string): ParsedDocument {
  const text = readFileSync(filePath, "utf-8");
  return { text };
}
