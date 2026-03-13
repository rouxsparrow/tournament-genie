"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  checkDuplicateAssignments,
  checkLegacyCourtIds,
  deleteAllPlayersWithRelatedData,
  deleteAllTeamsWithRelatedData,
  clearMdGroupRefereeSubmissions,
  clearRefereeSubmissions,
  clearDuplicateAssignments,
  clearComputeSeriesSplitData,
  type DuplicateAssignmentSummary,
  fixLegacyCourtIds,
  type LegacyCourtSummary,
  previewTestDataCleanup,
  removeTestDataCleanup,
  type TestDataCleanupPreview,
} from "@/app/utilities/actions";
import { checkInAllPlayers, uncheckInAllPlayers } from "@/app/player-checkin/actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type UtilitiesClientProps = {
  initialSummary: DuplicateAssignmentSummary;
  initialLegacySummary: LegacyCourtSummary;
  initialAutoScheduleFunctionEnabled: boolean;
};

function totalDuplicates(summary: DuplicateAssignmentSummary) {
  return (
    summary.byCourt.length + summary.byGroupMatch.length + summary.byKnockoutMatch.length
  );
}

function SectionShell({
  title,
  subtitle,
  defaultOpen = false,
  children,
}: {
  title: string;
  subtitle: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details
      className="rounded-xl border border-border bg-card p-4 space-y-4 open:space-y-4"
      open={defaultOpen}
    >
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <span className="text-xs text-muted-foreground">Toggle</span>
      </summary>
      <div className="mt-4 space-y-4">{children}</div>
    </details>
  );
}

export function UtilitiesClient({
  initialSummary,
  initialLegacySummary,
  initialAutoScheduleFunctionEnabled,
}: UtilitiesClientProps) {
  const [refereeMatchType, setRefereeMatchType] = useState<"ALL" | "GROUP" | "KNOCKOUT">("ALL");
  const [refereeCategory, setRefereeCategory] = useState<"ALL" | "MD" | "WD" | "XD">("ALL");
  const [splitCleanupCategory, setSplitCleanupCategory] = useState<"MD" | "WD" | "XD">("MD");
  const [testPreview, setTestPreview] = useState<TestDataCleanupPreview | null>(null);
  const [confirmToken, setConfirmToken] = useState("");
  const [summary, setSummary] = useState(initialSummary);
  const [legacySummary, setLegacySummary] = useState(initialLegacySummary);
  const [autoScheduleFunctionEnabled] = useState(initialAutoScheduleFunctionEnabled);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const runCheck = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await checkDuplicateAssignments();
      if (!result || "error" in result) {
        setMessage(result?.error ?? "Failed to check duplicate assignments.");
        return;
      }
      setSummary(result.summary);
      setMessage("Check complete.");
    });
  };

  const runClear = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await clearDuplicateAssignments();
      if (!result || "error" in result) {
        setMessage(result?.error ?? "Failed to clear duplicates.");
        return;
      }
      setSummary(result.summary);
      setMessage(`Cleanup complete. Rows updated: ${result.cleared.total}`);
    });
  };

  const runLegacyCheck = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await checkLegacyCourtIds();
      if (!result || "error" in result) {
        setMessage(result?.error ?? "Failed to check legacy court IDs.");
        return;
      }
      setLegacySummary(result.summary);
      setMessage("Legacy court check complete.");
    });
  };

  const runLegacyFix = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await fixLegacyCourtIds();
      if (!result || "error" in result) {
        setMessage(result?.error ?? "Failed to fix legacy court IDs.");
        return;
      }
      setLegacySummary(result.summary);
      setMessage(
        `Legacy court fix complete. Moved assignments: ${result.updated.movedAssignments}; removed legacy courts: ${result.updated.deletedLegacyCourts}.`
      );
    });
  };

  const runClearRefereeSubmissions = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await clearRefereeSubmissions({
        matchType: refereeMatchType,
        categoryCode: refereeCategory,
      });
      if (!result || "error" in result) {
        setMessage(result?.error ?? "Failed to clear referee submissions.");
        return;
      }
      setMessage(
        `Referee submissions cleared: ${result.deletedCount}. Remaining with same filters: ${result.remainingCount}.`
      );
    });
  };

  const runClearMdGroupRefereeSubmissions = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await clearMdGroupRefereeSubmissions();
      if (!result || "error" in result) {
        setMessage(result?.error ?? "Failed to clear MD group referee submissions.");
        return;
      }
      setMessage(
        `MD group referee submissions cleared: ${result.deletedCount}. Remaining with same filters: ${result.remainingCount}.`
      );
    });
  };

  const runCheckInAllPlayers = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await checkInAllPlayers();
      if (!result || "error" in result) {
        setMessage(result?.error ?? "Failed to check in all players.");
        return;
      }
      setMessage(`All players checked in: ${result.updatedCount}.`);
    });
  };

  const runUncheckInAllPlayers = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await uncheckInAllPlayers();
      if (!result || "error" in result) {
        setMessage(result?.error ?? "Failed to uncheck all players.");
        return;
      }
      setMessage(`All players unchecked: ${result.updatedCount}.`);
    });
  };

  const runTestPreview = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await previewTestDataCleanup();
      if (!result || "error" in result) {
        setMessage(result?.error ?? "Failed to preview test data cleanup.");
        return;
      }
      setTestPreview(result.preview);
      setMessage("Test data preview complete.");
    });
  };

  const runTestCleanup = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await removeTestDataCleanup(confirmToken);
      if (!result || "error" in result) {
        setMessage(result?.error ?? "Failed to remove test data.");
        return;
      }
      setTestPreview(result.remaining);
      setConfirmToken("");
      setMessage("Test data cleanup complete.");
    });
  };

  const runDeleteAllTeams = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await deleteAllTeamsWithRelatedData();
      if (!result || "error" in result) {
        setMessage(result?.error ?? "Failed to delete all teams.");
        return;
      }
      setMessage(
        `All teams cleanup complete. Deleted teams: ${result.deleted.teams}; deleted group matches: ${result.deleted.groupMatches}; deleted knockout matches: ${result.deleted.knockoutMatches}; remaining players: ${result.remaining.players}.`
      );
    });
  };

  const runDeleteAllPlayers = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await deleteAllPlayersWithRelatedData();
      if (!result || "error" in result) {
        setMessage(result?.error ?? "Failed to delete all players.");
        return;
      }
      setMessage(
        `All players cleanup complete. Deleted players: ${result.deleted.players}; deleted teams: ${result.deleted.teams}; remaining teams: ${result.remaining.teams}.`
      );
    });
  };

  const runClearComputeSeriesSplitData = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await clearComputeSeriesSplitData({
        categoryCode: splitCleanupCategory,
      });
      if (!result || "error" in result) {
        setMessage(result?.error ?? "Failed to clear Compute Series Split data.");
        return;
      }
      setMessage(
        `Compute Series Split cleanup complete for ${result.categoryCode}. Deleted qualifiers: ${result.deleted.seriesQualifiers}; knockout matches: ${result.deleted.knockoutMatches}; seeds: ${result.deleted.knockoutSeeds}; random draws: ${result.deleted.knockoutRandomDraws}; total rows: ${result.deleted.total}.`
      );
    });
  };

  const canRunTestCleanup = Boolean(
    testPreview && testPreview.totalRows > 0 && confirmToken === "CONFIRM_TEST_DELETE"
  );

  return (
    <div className="mt-6 space-y-6">
      {message ? (
        <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-foreground">
          {message}
        </div>
      ) : null}

      <SectionShell
        title="Quick Fix: MD Clear Matches"
        subtitle="Use this before clearing MD group matches if you hit referee submission constraint errors."
        defaultOpen
      >
        <div className="flex justify-end">
          <Button type="button" variant="destructive" onClick={runClearMdGroupRefereeSubmissions} disabled={pending}>
            Clear MD Group Referee Submissions
          </Button>
        </div>
      </SectionShell>

      <SectionShell
        title="Player Check-in"
        subtitle="Bulk operations for player arrival status."
      >
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={runCheckInAllPlayers} disabled={pending}>
            Check in all players
          </Button>
          <Button type="button" variant="destructive" onClick={runUncheckInAllPlayers} disabled={pending}>
            Un checkin all players
          </Button>
        </div>
      </SectionShell>

      <SectionShell
        title="Tournament Data Cleanup"
        subtitle="Delete all teams or players with full related cleanup."
      >
        <p className="text-sm text-muted-foreground">
          These actions are irreversible and will remove related matches, qualifiers, seeds, and schedule queue artifacts.
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="destructive" disabled={pending}>
                Delete all teams
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete all teams?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will delete all teams and related tournament data including groups, group matches, knockout brackets, and queue artifacts. Players will remain. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={runDeleteAllTeams}
                  className="bg-destructive text-white hover:bg-destructive/90"
                >
                  Delete all teams
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="destructive" disabled={pending}>
                Delete all players
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete all players?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will delete all players and all team-related tournament data including groups, group matches, knockout brackets, and queue artifacts. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={runDeleteAllPlayers}
                  className="bg-destructive text-white hover:bg-destructive/90"
                >
                  Delete all players
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </SectionShell>

      <SectionShell
        title="Compute Series Split Cleanup"
        subtitle="Clear series qualifiers and full knockout artifacts for one category."
      >
        <div className="grid gap-2 sm:grid-cols-[180px_1fr] sm:items-center">
          <label htmlFor="split-cleanup-category" className="text-sm text-muted-foreground">
            Category
          </label>
          <select
            id="split-cleanup-category"
            value={splitCleanupCategory}
            onChange={(event) =>
              setSplitCleanupCategory(event.target.value as "MD" | "WD" | "XD")
            }
            disabled={pending}
            className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
          >
            <option value="MD">MD</option>
            <option value="WD">WD</option>
            <option value="XD">XD</option>
          </select>
        </div>

        <div className="flex justify-end">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="destructive" disabled={pending}>
                Clear Compute Series Split data
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Clear {splitCleanupCategory} Compute Series Split data?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  This removes Series Split qualifiers, knockout matches, seeds, non-global random draws, and knockout schedule/referee artifacts for {splitCleanupCategory}. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={runClearComputeSeriesSplitData}
                  className="bg-destructive text-white hover:bg-destructive/90"
                >
                  Clear Compute Series Split data
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </SectionShell>

      <SectionShell
        title="Auto Schedule Function"
        subtitle="Deprecated. Auto Schedule is permanently disabled for manual-only scheduling."
      >
        <div className="rounded-md border border-border bg-muted/30 p-3">
          <div className="text-xs text-muted-foreground">Current status</div>
          <div className="text-lg font-semibold text-foreground">
            {autoScheduleFunctionEnabled ? "Enabled" : "Disabled (forced off)"}
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            Runtime scheduling no longer allows Auto Schedule to be enabled.
          </div>
        </div>
      </SectionShell>

      <SectionShell
        title="Duplicate Assignments"
        subtitle="One bucket means one duplicated key (for example same stage + same courtId)."
      >
        <div className="flex flex-wrap items-start justify-end gap-3">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={runCheck} disabled={pending}>
              Check duplicate assignments
            </Button>
            <Button type="button" onClick={runClear} disabled={pending}>
              Clear duplicate assignments
            </Button>
          </div>
        </div>

        <div className="rounded-md border border-border bg-muted/30 p-3">
          <div className="text-xs text-muted-foreground">Duplicate buckets</div>
          <div className="text-lg font-semibold text-foreground">{totalDuplicates(summary)}</div>
        </div>

        <section className="rounded-xl border border-border bg-card p-4">
          <h3 className="text-base font-semibold text-foreground">By Court + Stage</h3>
          {summary.byCourt.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No duplicates.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-2">Stage</th>
                    <th className="py-2 pr-2">Court</th>
                    <th className="py-2 pr-2">Count</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.byCourt.map((row) => (
                    <tr key={`${row.stage}:${row.courtId}`} className="border-b border-border/60">
                      <td className="py-2 pr-2">{row.stage}</td>
                      <td className="py-2 pr-2">{row.courtId}</td>
                      <td className="py-2 pr-2">{row.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded-xl border border-border bg-card p-4">
          <h3 className="text-base font-semibold text-foreground">By Group Match + Stage</h3>
          {summary.byGroupMatch.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No duplicates.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-2">Stage</th>
                    <th className="py-2 pr-2">Group Match ID</th>
                    <th className="py-2 pr-2">Count</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.byGroupMatch.map((row) => (
                    <tr
                      key={`${row.stage}:${row.groupMatchId}`}
                      className="border-b border-border/60"
                    >
                      <td className="py-2 pr-2">{row.stage}</td>
                      <td className="py-2 pr-2">{row.groupMatchId}</td>
                      <td className="py-2 pr-2">{row.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded-xl border border-border bg-card p-4">
          <h3 className="text-base font-semibold text-foreground">By Knockout Match + Stage</h3>
          {summary.byKnockoutMatch.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No duplicates.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-2">Stage</th>
                    <th className="py-2 pr-2">Knockout Match ID</th>
                    <th className="py-2 pr-2">Count</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.byKnockoutMatch.map((row) => (
                    <tr
                      key={`${row.stage}:${row.knockoutMatchId}`}
                      className="border-b border-border/60"
                    >
                      <td className="py-2 pr-2">{row.stage}</td>
                      <td className="py-2 pr-2">{row.knockoutMatchId}</td>
                      <td className="py-2 pr-2">{row.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </SectionShell>

      <SectionShell
        title="Legacy Court IDs (P5-P9)"
        subtitle="Canonical DB court IDs are C1-C5. This detects and fixes legacy IDs."
      >
        <div className="flex flex-wrap items-start justify-end gap-3">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={runLegacyCheck} disabled={pending}>
              Check legacy courts (select)
            </Button>
            <Button type="button" onClick={runLegacyFix} disabled={pending}>
              Fix legacy courts
            </Button>
          </div>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <div className="text-xs text-muted-foreground">Legacy court rows</div>
            <div className="text-lg font-semibold text-foreground">
              {legacySummary.legacyCourtRows}
            </div>
          </div>
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <div className="text-xs text-muted-foreground">Legacy stage locks</div>
            <div className="text-lg font-semibold text-foreground">
              {legacySummary.legacyStageLockRows}
            </div>
          </div>
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <div className="text-xs text-muted-foreground">Legacy assignments</div>
            <div className="text-lg font-semibold text-foreground">
              {legacySummary.legacyAssignmentRows}
            </div>
          </div>
        </div>

        {legacySummary.byCourt.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No legacy court IDs found.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="py-2 pr-2">Court ID</th>
                  <th className="py-2 pr-2">Stage lock rows</th>
                  <th className="py-2 pr-2">Assignment rows</th>
                </tr>
              </thead>
              <tbody>
                {legacySummary.byCourt.map((row) => (
                  <tr key={row.courtId} className="border-b border-border/60">
                    <td className="py-2 pr-2">{row.courtId}</td>
                    <td className="py-2 pr-2">{row.stageLockCount}</td>
                    <td className="py-2 pr-2">{row.assignmentCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionShell>

      <SectionShell
        title="Test Data Cleanup"
        subtitle="Preview and remove tagged test fixtures (E2E/KR/Import) only."
      >
        <div className="flex flex-wrap items-start justify-end gap-3">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={runTestPreview} disabled={pending}>
              Preview test data cleanup
            </Button>
            <Button type="button" onClick={runTestCleanup} disabled={pending || !canRunTestCleanup}>
              Remove test data
            </Button>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-[220px_1fr] sm:items-center">
          <label htmlFor="confirm-test-delete" className="text-sm text-muted-foreground">
            Confirmation token
          </label>
          <input
            id="confirm-test-delete"
            value={confirmToken}
            onChange={(event) => setConfirmToken(event.target.value)}
            placeholder="Type CONFIRM_TEST_DELETE"
            className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        {!testPreview ? (
          <p className="text-sm text-muted-foreground">Run preview to see what will be deleted.</p>
        ) : (
          <>
            <div className="rounded-md border border-border bg-muted/30 p-3">
              <div className="text-xs text-muted-foreground">Rows to delete (total)</div>
              <div className="text-lg font-semibold text-foreground">{testPreview.totalRows}</div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-2">Table</th>
                    <th className="py-2 pr-2">Rows</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(testPreview.summary).map(([table, rows]) => (
                    <tr key={table} className="border-b border-border/60">
                      <td className="py-2 pr-2">{table}</td>
                      <td className="py-2 pr-2">{rows}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </SectionShell>

      <SectionShell
        title="Referee Submissions"
        subtitle="Delete referee submissions to unblock group/knockout match cleanup."
      >
        <div className="grid gap-2 sm:grid-cols-[180px_1fr] sm:items-center">
          <label htmlFor="referee-match-type" className="text-sm text-muted-foreground">
            Match type
          </label>
          <select
            id="referee-match-type"
            value={refereeMatchType}
            onChange={(event) =>
              setRefereeMatchType(event.target.value as "ALL" | "GROUP" | "KNOCKOUT")
            }
            className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="ALL">All</option>
            <option value="GROUP">Group</option>
            <option value="KNOCKOUT">Knockout</option>
          </select>
        </div>

        <div className="grid gap-2 sm:grid-cols-[180px_1fr] sm:items-center">
          <label htmlFor="referee-category" className="text-sm text-muted-foreground">
            Category
          </label>
          <select
            id="referee-category"
            value={refereeCategory}
            onChange={(event) =>
              setRefereeCategory(event.target.value as "ALL" | "MD" | "WD" | "XD")
            }
            className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="ALL">All</option>
            <option value="MD">MD</option>
            <option value="WD">WD</option>
            <option value="XD">XD</option>
          </select>
        </div>

        <div className="flex justify-end">
          <Button type="button" variant="destructive" onClick={runClearRefereeSubmissions} disabled={pending}>
            Clear referee submissions
          </Button>
        </div>
      </SectionShell>
    </div>
  );
}
