import { csvTemplate } from "@/lib/template-utils";

export const runtime = "nodejs";

export async function GET() {
  const csv = csvTemplate(["Player 1", "Player 2", "Category"]);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=\"teams-template.csv\"",
    },
  });
}
