// Minimal dependency-free CSV parser. Handles quoted fields (with escaped
// double quotes), embedded newlines, and auto-detects the delimiter so that
// German exports using ';' work the same as comma-separated files.

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

const detectDelimiter = (text: string): string => {
  const firstLine = text.split(/\r?\n/)[0] ?? '';
  const candidates: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
  let inQuotes = false;
  for (const c of firstLine) {
    if (c === '"') inQuotes = !inQuotes;
    else if (!inQuotes && c in candidates) candidates[c]++;
  }
  return Object.entries(candidates).sort((a, b) => b[1] - a[1])[0][0];
};

// Parse raw CSV text into a list of records (each a list of string fields).
const parseRecords = (text: string, delimiter: string): string[][] => {
  const records: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      records.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    records.push(row);
  }
  return records;
};

// `firstRowHeader` controls whether the first record is treated as column
// names. When false, generic "Column N" headers are generated and every record
// becomes data.
export const parseCsv = (text: string, firstRowHeader = true): ParsedCsv => {
  const clean = text.replace(/^﻿/, '');
  const delimiter = detectDelimiter(clean);
  const records = parseRecords(clean, delimiter).filter((r) =>
    r.some((cell) => cell.trim() !== ''),
  );
  if (records.length === 0) return { headers: [], rows: [] };

  if (!firstRowHeader) {
    const width = Math.max(...records.map((r) => r.length));
    const headers = Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
    return { headers, rows: records };
  }

  const [header, ...rows] = records;
  return { headers: header.map((h) => h.trim()), rows };
};
