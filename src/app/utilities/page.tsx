import { redirect } from "next/navigation";
import { getRoleFromRequest } from "@/lib/auth";
import { UtilitiesClient } from "@/app/utilities/utilities-client";
import {
  checkDuplicateAssignments,
  checkLegacyCourtIds,
  getAutoScheduleFunctionState,
} from "@/app/utilities/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Utilities" };

export default async function UtilitiesPage() {
  const role = await getRoleFromRequest();
  if (role !== "admin") {
    redirect("/presenting");
  }

  const [duplicateResult, legacyResult, autoScheduleFunctionResult] = await Promise.all([
    checkDuplicateAssignments(),
    checkLegacyCourtIds(),
    getAutoScheduleFunctionState(),
  ]);
  const initialSummary =
    duplicateResult && !("error" in duplicateResult)
      ? duplicateResult.summary
      : { byCourt: [], byGroupMatch: [], byKnockoutMatch: [] };
  const initialLegacySummary =
    legacyResult && !("error" in legacyResult)
      ? legacyResult.summary
      : { legacyCourtRows: 0, legacyStageLockRows: 0, legacyAssignmentRows: 0, byCourt: [] };
  const initialAutoScheduleFunctionEnabled =
    autoScheduleFunctionResult && !("error" in autoScheduleFunctionResult)
      ? autoScheduleFunctionResult.enabled
      : true;

  return (
    <section className="rounded-2xl border border-border bg-card p-8">
      <h1 className="text-2xl font-semibold text-foreground">Utilities</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Admin-only emergency tools for schedule assignment integrity.
      </p>
      <UtilitiesClient
        initialSummary={initialSummary}
        initialLegacySummary={initialLegacySummary}
        initialAutoScheduleFunctionEnabled={initialAutoScheduleFunctionEnabled}
      />
    </section>
  );
}
