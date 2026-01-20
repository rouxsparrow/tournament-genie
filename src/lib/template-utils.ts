import * as XLSX from "xlsx";

export function csvTemplate(headers: string[]) {
  return `${headers.join(",")}\n`;
}

export function xlsxTemplate(headers: string[], sheetName: string) {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([headers]);
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}
