"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type DuplicateByCourtRow = {
  stage: "GROUP" | "KNOCKOUT";
  courtId: string;
  count: number;
};

type DuplicateByGroupRow = {
  stage: "GROUP" | "KNOCKOUT";
  groupMatchId: string;
  count: number;
};

type DuplicateByKnockoutRow = {
  stage: "GROUP" | "KNOCKOUT";
  knockoutMatchId: string;
  count: number;
};

export type DuplicateAssignmentSummary = {
  byCourt: DuplicateByCourtRow[];
  byGroupMatch: DuplicateByGroupRow[];
  byKnockoutMatch: DuplicateByKnockoutRow[];
};

async function readDuplicateSummary(): Promise<DuplicateAssignmentSummary> {
  const [byCourt, byGroupMatch, byKnockoutMatch] = await Promise.all([
    prisma.$queryRaw<DuplicateByCourtRow[]>`
      SELECT
        stage,
        "courtId" AS "courtId",
        COUNT(*)::int AS count
      FROM "CourtAssignment"
      WHERE status = 'ACTIVE'::"AssignmentStatus"
      GROUP BY stage, "courtId"
      HAVING COUNT(*) > 1
      ORDER BY stage, "courtId"
    `,
    prisma.$queryRaw<DuplicateByGroupRow[]>`
      SELECT
        stage,
        "groupMatchId" AS "groupMatchId",
        COUNT(*)::int AS count
      FROM "CourtAssignment"
      WHERE status = 'ACTIVE'::"AssignmentStatus"
        AND "groupMatchId" IS NOT NULL
      GROUP BY stage, "groupMatchId"
      HAVING COUNT(*) > 1
      ORDER BY stage, "groupMatchId"
    `,
    prisma.$queryRaw<DuplicateByKnockoutRow[]>`
      SELECT
        stage,
        "knockoutMatchId" AS "knockoutMatchId",
        COUNT(*)::int AS count
      FROM "CourtAssignment"
      WHERE status = 'ACTIVE'::"AssignmentStatus"
        AND "knockoutMatchId" IS NOT NULL
      GROUP BY stage, "knockoutMatchId"
      HAVING COUNT(*) > 1
      ORDER BY stage, "knockoutMatchId"
    `,
  ]);

  return { byCourt, byGroupMatch, byKnockoutMatch };
}

export async function checkDuplicateAssignments() {
  const guard = await requireAdmin({ onFail: "return" });
  if (guard) return guard;
  const summary = await readDuplicateSummary();
  return { ok: true as const, summary };
}

export async function clearDuplicateAssignments() {
  const guard = await requireAdmin({ onFail: "return" });
  if (guard) return guard;

  const [clearedByCourt, clearedByGroup, clearedByKnockout] = await Promise.all([
    prisma.$executeRaw`
      WITH ranked AS (
        SELECT
          id,
          ROW_NUMBER() OVER (
            PARTITION BY stage, "courtId"
            ORDER BY "assignedAt" DESC, id DESC
          ) AS rn
        FROM "CourtAssignment"
        WHERE status = 'ACTIVE'::"AssignmentStatus"
      )
      UPDATE "CourtAssignment" ca
      SET
        status = 'CANCELED'::"AssignmentStatus",
        "clearedAt" = COALESCE(ca."clearedAt", NOW())
      FROM ranked
      WHERE ca.id = ranked.id
        AND ranked.rn > 1
    `,
    prisma.$executeRaw`
      WITH ranked AS (
        SELECT
          id,
          ROW_NUMBER() OVER (
            PARTITION BY stage, "groupMatchId"
            ORDER BY "assignedAt" DESC, id DESC
          ) AS rn
        FROM "CourtAssignment"
        WHERE status = 'ACTIVE'::"AssignmentStatus"
          AND "groupMatchId" IS NOT NULL
      )
      UPDATE "CourtAssignment" ca
      SET
        status = 'CANCELED'::"AssignmentStatus",
        "clearedAt" = COALESCE(ca."clearedAt", NOW())
      FROM ranked
      WHERE ca.id = ranked.id
        AND ranked.rn > 1
    `,
    prisma.$executeRaw`
      WITH ranked AS (
        SELECT
          id,
          ROW_NUMBER() OVER (
            PARTITION BY stage, "knockoutMatchId"
            ORDER BY "assignedAt" DESC, id DESC
          ) AS rn
        FROM "CourtAssignment"
        WHERE status = 'ACTIVE'::"AssignmentStatus"
          AND "knockoutMatchId" IS NOT NULL
      )
      UPDATE "CourtAssignment" ca
      SET
        status = 'CANCELED'::"AssignmentStatus",
        "clearedAt" = COALESCE(ca."clearedAt", NOW())
      FROM ranked
      WHERE ca.id = ranked.id
        AND ranked.rn > 1
    `,
  ]);

  const summary = await readDuplicateSummary();
  revalidatePath("/utilities");
  revalidatePath("/schedule");

  return {
    ok: true as const,
    cleared: {
      byCourt: Number(clearedByCourt),
      byGroup: Number(clearedByGroup),
      byKnockout: Number(clearedByKnockout),
      total: Number(clearedByCourt) + Number(clearedByGroup) + Number(clearedByKnockout),
    },
    summary,
  };
}
