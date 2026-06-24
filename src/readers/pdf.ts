import { readFileSync } from "node:fs";
import type { ParsedDocument } from "./index.js";

export async function readPdf(filePath: string): Promise<ParsedDocument> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { PDFParse } = await import("pdf-parse");
  const buffer = readFileSync(filePath);
  
  const parser = new PDFParse({ data: buffer });
  try {
    const data = await parser.getText();
    const info = await parser.getInfo();
    return {
      text: data.text,
      pageCount: data.total,
      metadata: info as unknown as Record<string, unknown>,
    };
  } finally {
    await parser.destroy();
  }
}
