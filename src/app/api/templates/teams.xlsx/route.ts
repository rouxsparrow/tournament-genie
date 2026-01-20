import { xlsxTemplate } from "@/lib/template-utils";

export const runtime = "nodejs";

export async function GET() {
  const buffer = xlsxTemplate(["Player 1", "Player 2", "Category"], "Teams");
  return new Response(buffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": "attachment; filename=\"teams-template.xlsx\"",
    },
  });
}
