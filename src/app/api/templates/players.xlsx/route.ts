import { xlsxTemplate } from "@/lib/template-utils";

export const runtime = "nodejs";

export async function GET() {
  const buffer = xlsxTemplate(["Player name", "Gender"], "Players");
  return new Response(buffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": "attachment; filename=\"players-template.xlsx\"",
    },
  });
}
