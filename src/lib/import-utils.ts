import Papa from "papaparse";
import * as XLSX from "xlsx";

export type ParsedSheet = {
  headers: string[];
  rows: string[][];
};

type HeaderMap = Map<string, number>;

export function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function normalizeCell(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

export function parseCsv(buffer: Buffer): ParsedSheet {
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
  const result = Papa.parse<string[]>(text, {
    skipEmptyLines: "greedy",
  });

  if (result.errors.length > 0) {
    const message = result.errors[0]?.message ?? "Failed to parse CSV.";
    throw new Error(message);
  }

  const rows = result.data ?? [];
  const headers = (rows[0] ?? []).map(normalizeCell);
  const body = rows.slice(1).map((row) => row.map(normalizeCell));

  return { headers, rows: body };
}

export function parseXlsx(buffer: Buffer): ParsedSheet {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("Missing worksheet in XLSX file.");
  }

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
  });

  const headers = (rows[0] ?? []).map(normalizeCell);
  const body = rows.slice(1).map((row) => row.map(normalizeCell));

  return { headers, rows: body };
}

export function mapHeaders(
  headers: string[],
  aliases: Record<string, string>
): HeaderMap {
  const mapped = new Map<string, number>();
  headers.forEach((header, index) => {
    const normalized = normalizeHeader(header);
    const key = aliases[normalized];
    if (key && !mapped.has(key)) {
      mapped.set(key, index);
    }
  });
  return mapped;
}

export function getMappedValue(
  row: string[],
  headerMap: HeaderMap,
  key: string
) {
  const index = headerMap.get(key);
  if (index === undefined) return "";
  return normalizeCell(row[index]);
}
