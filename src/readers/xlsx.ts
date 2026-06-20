import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import type { ParsedDocument } from "./index.js";

export async function readXlsx(filePath: string): Promise<ParsedDocument> {
  const buffer = readFileSync(filePath);
  const workbook = XLSX.read(buffer, { type: "buffer" });
  
  const lines: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet, { strip: true });
    lines.push(`## Hoja: ${sheetName}\n${csv}`);
  }

  return {
    text: lines.join("\n\n"),
    metadata: { sheets: workbook.SheetNames },
  };
}
