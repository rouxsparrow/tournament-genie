import { csvTemplate } from "@/lib/template-utils";

export const runtime = "nodejs";

export async function GET() {
  const csv = csvTemplate(["Player name", "Gender"]);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=\"players-template.csv\"",
    },
  });
}
