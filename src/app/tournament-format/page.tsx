import { Prisma } from "@prisma/client";
import { getRoleFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TOURNAMENT_FORMAT_SINGLETON_ID } from "@/app/tournament-format/constants";
import {
  TournamentFormatClient,
  type TournamentFormatSection,
} from "@/app/tournament-format/tournament-format-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tournament Format" };

function parseSections(input: Prisma.JsonValue | null | undefined): TournamentFormatSection[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const sections: TournamentFormatSection[] = [];
  for (const item of input) {
    const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const text = typeof row.text === "string" ? row.text.trim() : "";
    const rawImageUrl = typeof row.imageUrl === "string" ? row.imageUrl.trim() : "";
    const imageUrl = rawImageUrl
      ? rawImageUrl.startsWith("/") || /^https?:\/\//i.test(rawImageUrl)
        ? rawImageUrl
        : `/${rawImageUrl}`
      : null;

    if (text || imageUrl) {
      sections.push({ text, imageUrl });
    }
  }

  return sections;
}

export default async function TournamentFormatPage() {
  const [role, tournamentFormat] = await Promise.all([
    getRoleFromRequest(),
    prisma.tournamentFormat.findUnique({
      where: { id: TOURNAMENT_FORMAT_SINGLETON_ID },
      select: {
        sections: true,
      },
    }),
  ]);

  const sections = parseSections(tournamentFormat?.sections);

  return (
    <section className="rounded-2xl border border-border bg-card p-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Tournament Format</h1>
      </div>

      <TournamentFormatClient isAdmin={role === "admin"} initialSections={sections} />
    </section>
  );
}
