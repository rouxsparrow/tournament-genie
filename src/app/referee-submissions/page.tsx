import Link from "next/link";
import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { prisma } from "@/lib/prisma";
import { getRoleFromRequest } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Referee Submissions" };

const PAGE_SIZE = 50;
const MATCH_TYPE_VALUES = ["ALL", "GROUP", "KNOCKOUT"] as const;
const CATEGORY_VALUES = ["ALL", "MD", "WD", "XD"] as const;

type MatchTypeFilter = (typeof MATCH_TYPE_VALUES)[number];
type CategoryFilter = (typeof CATEGORY_VALUES)[number];

type RefereeSubmissionsPageProps = {
  searchParams?: Promise<{
    matchType?: string | string[];
    category?: string | string[];
    refereeId?: string | string[];
    from?: string | string[];
    to?: string | string[];
    q?: string | string[];
    page?: string | string[];
  }>;
};

function toSingle(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function parseMatchType(value: string): MatchTypeFilter {
  return MATCH_TYPE_VALUES.includes(value as MatchTypeFilter)
    ? (value as MatchTypeFilter)
    : "ALL";
}

function parseCategory(value: string): CategoryFilter {
  return CATEGORY_VALUES.includes(value as CategoryFilter)
    ? (value as CategoryFilter)
    : "ALL";
}

function parseDateInput(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function parsePage(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
}

function toStartOfDayUtc(dateText: string) {
  return new Date(`${dateText}T00:00:00.000Z`);
}

function toEndOfDayUtc(dateText: string) {
  return new Date(`${dateText}T23:59:59.999Z`);
}

function formatUtc(date: Date) {
  return date.toISOString().replace("T", " ").replace("Z", " UTC");
}

function scoreSummary(scores: Prisma.JsonValue) {
  if (!scores || typeof scores !== "object" || Array.isArray(scores)) return "-";

  const payload = scores as Record<string, unknown>;
  const chunks: string[] = [];

  for (const gameNo of [1, 2, 3] as const) {
    const game = payload[`game${gameNo}`];
    if (!game || typeof game !== "object" || Array.isArray(game)) continue;

    const gamePayload = game as Record<string, unknown>;
    const home = gamePayload.home;
    const away = gamePayload.away;
    if (typeof home === "number" && typeof away === "number") {
      chunks.push(`G${gameNo} ${home}-${away}`);
    }
  }

  return chunks.length > 0 ? chunks.join(" | ") : "-";
}

export default async function RefereeSubmissionsPage({ searchParams }: RefereeSubmissionsPageProps) {
  const role = await getRoleFromRequest();
  if (role !== "admin") {
    redirect("/presenting");
  }

  const resolved = (await searchParams) ?? {};
  const matchType = parseMatchType(toSingle(resolved.matchType).toUpperCase());
  const category = parseCategory(toSingle(resolved.category).toUpperCase());
  const refereeIdRaw = toSingle(resolved.refereeId).trim();
  const refereeId = refereeIdRaw ? refereeIdRaw : "ALL";
  const from = parseDateInput(toSingle(resolved.from));
  const to = parseDateInput(toSingle(resolved.to));
  const q = toSingle(resolved.q).trim();
  const pageRequested = parsePage(toSingle(resolved.page));

  const where: Prisma.RefereeSubmissionWhereInput = {};

  if (matchType !== "ALL") {
    where.matchType = matchType;
  }
  if (category !== "ALL") {
    where.categoryCode = category;
  }
  if (refereeId !== "ALL") {
    where.refereeAccountId = refereeId;
  }
  if (from || to) {
    where.submittedAt = {
      ...(from ? { gte: toStartOfDayUtc(from) } : {}),
      ...(to ? { lte: toEndOfDayUtc(to) } : {}),
    };
  }
  if (q) {
    where.OR = [
      { notes: { contains: q, mode: "insensitive" } },
      { groupMatchId: { contains: q, mode: "insensitive" } },
      { knockoutMatchId: { contains: q, mode: "insensitive" } },
      {
        groupMatch: {
          homeTeam: {
            name: { contains: q, mode: "insensitive" },
          },
        },
      },
      {
        groupMatch: {
          awayTeam: {
            name: { contains: q, mode: "insensitive" },
          },
        },
      },
      {
        knockoutMatch: {
          homeTeam: {
            name: { contains: q, mode: "insensitive" },
          },
        },
      },
      {
        knockoutMatch: {
          awayTeam: {
            name: { contains: q, mode: "insensitive" },
          },
        },
      },
    ];
  }

  const [referees, totalCount] = await Promise.all([
    prisma.refereeAccount.findMany({
      orderBy: [{ displayName: "asc" }, { usernameNormalized: "asc" }],
      select: {
        id: true,
        username: true,
        displayName: true,
      },
    }),
    prisma.refereeSubmission.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const currentPage = Math.min(pageRequested, totalPages);
  const skip = (currentPage - 1) * PAGE_SIZE;

  const submissions = await prisma.refereeSubmission.findMany({
    where,
    orderBy: { submittedAt: "desc" },
    skip,
    take: PAGE_SIZE,
    include: {
      refereeAccount: {
        select: {
          id: true,
          username: true,
          displayName: true,
        },
      },
      groupMatch: {
        select: {
          id: true,
          group: { select: { name: true } },
          homeTeam: { select: { name: true } },
          awayTeam: { select: { name: true } },
        },
      },
      knockoutMatch: {
        select: {
          id: true,
          series: true,
          round: true,
          matchNo: true,
          homeTeam: { select: { name: true } },
          awayTeam: { select: { name: true } },
        },
      },
    },
  });

  const baseParams = new URLSearchParams();
  baseParams.set("matchType", matchType);
  baseParams.set("category", category);
  baseParams.set("refereeId", refereeId);
  if (from) baseParams.set("from", from);
  if (to) baseParams.set("to", to);
  if (q) baseParams.set("q", q);

  function pageHref(page: number) {
    const params = new URLSearchParams(baseParams);
    params.set("page", String(page));
    return `/referee-submissions?${params.toString()}`;
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Referee Submissions</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Read-only audit view of referee score submissions.
        </p>
      </div>

      <form method="get" className="mt-6 grid gap-3 rounded-xl border border-border bg-muted/20 p-4 md:grid-cols-3 lg:grid-cols-6">
        <div>
          <label htmlFor="matchType" className="text-xs font-medium text-muted-foreground">
            Match type
          </label>
          <select
            id="matchType"
            name="matchType"
            defaultValue={matchType}
            className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="ALL">All</option>
            <option value="GROUP">Group</option>
            <option value="KNOCKOUT">Knockout</option>
          </select>
        </div>

        <div>
          <label htmlFor="category" className="text-xs font-medium text-muted-foreground">
            Category
          </label>
          <select
            id="category"
            name="category"
            defaultValue={category}
            className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="ALL">All</option>
            <option value="MD">MD</option>
            <option value="WD">WD</option>
            <option value="XD">XD</option>
          </select>
        </div>

        <div>
          <label htmlFor="refereeId" className="text-xs font-medium text-muted-foreground">
            Referee
          </label>
          <select
            id="refereeId"
            name="refereeId"
            defaultValue={refereeId}
            className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="ALL">All referees</option>
            {referees.map((referee) => (
              <option key={referee.id} value={referee.id}>
                {referee.displayName} ({referee.username})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="from" className="text-xs font-medium text-muted-foreground">
            From
          </label>
          <input
            id="from"
            name="from"
            type="date"
            defaultValue={from}
            className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>

        <div>
          <label htmlFor="to" className="text-xs font-medium text-muted-foreground">
            To
          </label>
          <input
            id="to"
            name="to"
            type="date"
            defaultValue={to}
            className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>

        <div>
          <label htmlFor="q" className="text-xs font-medium text-muted-foreground">
            Search
          </label>
          <input
            id="q"
            name="q"
            type="text"
            defaultValue={q}
            placeholder="Notes, teams, match IDs"
            className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>

        <input type="hidden" name="page" value="1" />

        <div className="md:col-span-3 lg:col-span-6 flex items-center justify-end gap-2">
          <Button type="submit">Apply filters</Button>
          <Button asChild type="button" variant="outline">
            <Link href="/referee-submissions">Reset</Link>
          </Button>
        </div>
      </form>

      <div className="mt-4 text-sm text-muted-foreground">
        Showing {submissions.length} of {totalCount} submission(s). Page {currentPage} of {totalPages}.
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-muted/30 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Submitted At</th>
              <th className="px-3 py-2">Referee</th>
              <th className="px-3 py-2">Type/Category</th>
              <th className="px-3 py-2">Context</th>
              <th className="px-3 py-2">Teams</th>
              <th className="px-3 py-2">Scores</th>
              <th className="px-3 py-2">Locked</th>
              <th className="px-3 py-2">Notes</th>
            </tr>
          </thead>
          <tbody>
            {submissions.length === 0 ? (
              <tr>
                <td className="px-3 py-4 text-muted-foreground" colSpan={8}>
                  No referee submissions found for current filters.
                </td>
              </tr>
            ) : (
              submissions.map((submission) => {
                const isGroup = submission.matchType === "GROUP";
                const context = isGroup
                  ? `Group ${submission.groupMatch?.group?.name ?? "-"}`
                  : `Series ${submission.knockoutMatch?.series ?? "-"} • R${submission.knockoutMatch?.round ?? "-"} • Match ${submission.knockoutMatch?.matchNo ?? "-"}`;
                const home = isGroup
                  ? submission.groupMatch?.homeTeam?.name ?? "TBD"
                  : submission.knockoutMatch?.homeTeam?.name ?? "TBD";
                const away = isGroup
                  ? submission.groupMatch?.awayTeam?.name ?? "TBD"
                  : submission.knockoutMatch?.awayTeam?.name ?? "TBD";

                return (
                  <tr key={submission.id} className="border-b border-border/60 align-top">
                    <td className="px-3 py-2 text-xs text-muted-foreground">{formatUtc(submission.submittedAt)}</td>
                    <td className="px-3 py-2">
                      {submission.refereeAccount
                        ? `${submission.refereeAccount.displayName} (${submission.refereeAccount.username})`
                        : submission.submittedBy}
                    </td>
                    <td className="px-3 py-2">{submission.matchType} / {submission.categoryCode}</td>
                    <td className="px-3 py-2">{context}</td>
                    <td className="px-3 py-2">{home} vs {away}</td>
                    <td className="px-3 py-2">{scoreSummary(submission.scores)}</td>
                    <td className="px-3 py-2">{submission.lockState ? "Yes" : "No"}</td>
                    <td className="px-3 py-2">{submission.notes?.trim() ? submission.notes : "-"}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <Button asChild variant="outline" disabled={currentPage <= 1}>
          <Link href={pageHref(Math.max(1, currentPage - 1))} aria-disabled={currentPage <= 1}>
            Previous
          </Link>
        </Button>

        <Button asChild variant="outline" disabled={currentPage >= totalPages}>
          <Link
            href={pageHref(Math.min(totalPages, currentPage + 1))}
            aria-disabled={currentPage >= totalPages}
          >
            Next
          </Link>
        </Button>
      </div>
    </section>
  );
}
