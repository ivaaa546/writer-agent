/**
 * Document readers index — dispatches to the correct parser based on file extension.
 */

import { extname } from "node:path";
import { readPdf } from "./pdf.js";
import { readDocx } from "./docx.js";
import { readXlsx } from "./xlsx.js";
import { readText } from "./text.js";

export interface ParsedDocument {
  text: string;
  pageCount?: number;
  metadata?: Record<string, unknown>;
}

export async function parseDocument(filePath: string): Promise<ParsedDocument> {
  const ext = extname(filePath).toLowerCase();

  switch (ext) {
    case ".pdf":
      return readPdf(filePath);
    case ".docx":
      return readDocx(filePath);
    case ".xlsx":
    case ".xls":
    case ".csv":
      return readXlsx(filePath);
    case ".txt":
    case ".md":
    case ".markdown":
      return readText(filePath);
    default:
      throw new Error(`Formato de archivo no soportado: ${ext}. Formatos soportados: pdf, docx, xlsx, csv, txt, md`);
  }
}
