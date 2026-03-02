import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getRoleFromRequest } from "@/lib/auth";
import { RefereesClient } from "@/app/referees/referees-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Referees" };

export default async function RefereesPage() {
  const role = await getRoleFromRequest();
  if (role !== "admin") {
    redirect("/presenting");
  }

  const now = new Date();
  const [accounts, activeSessionCounts] = await Promise.all([
    prisma.refereeAccount.findMany({
      orderBy: [{ isActive: "desc" }, { usernameNormalized: "asc" }],
      select: {
        id: true,
        username: true,
        displayName: true,
        isActive: true,
        lastLoginAt: true,
      },
    }),
    prisma.refereeSession.groupBy({
      by: ["refereeAccountId"],
      where: {
        revokedAt: null,
        expiresAt: { gt: now },
      },
      _count: {
        _all: true,
      },
    }),
  ]);

  const countMap = new Map(
    activeSessionCounts.map((entry) => [entry.refereeAccountId, entry._count._all])
  );

  const initialAccounts = accounts.map((account) => ({
    id: account.id,
    username: account.username,
    displayName: account.displayName,
    isActive: account.isActive,
    lastLoginLabel: account.lastLoginAt
      ? `${account.lastLoginAt.toISOString().replace("T", " ").replace("Z", " UTC")}`
      : "Never",
    activeSessionCount: countMap.get(account.id) ?? 0,
  }));

  return (
    <section className="rounded-2xl border border-border bg-card p-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Referees</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage referee accounts, passwords, and active sessions.
        </p>
      </div>

      <RefereesClient initialAccounts={initialAccounts} />
    </section>
  );
}
