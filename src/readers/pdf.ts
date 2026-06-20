import { readFileSync } from "node:fs";
import type { ParsedDocument } from "./index.js";

export async function readPdf(filePath: string): Promise<ParsedDocument> {
  // Dynamic import to avoid issues in environments without the binary
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfParse: (buffer: Buffer) => Promise<{ text: string; numpages: number; info: unknown }> =
    await import("pdf-parse").then((m) => (m as any).default ?? m);
  const buffer = readFileSync(filePath);
  const data = await pdfParse(buffer);
  return {
    text: data.text,
    pageCount: data.numpages,
    metadata: data.info as Record<string, unknown>,
  };
}
