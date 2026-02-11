"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  checkDuplicateAssignments,
  clearDuplicateAssignments,
  type DuplicateAssignmentSummary,
} from "@/app/utilities/actions";

type UtilitiesClientProps = {
  initialSummary: DuplicateAssignmentSummary;
};

function totalDuplicates(summary: DuplicateAssignmentSummary) {
  return (
    summary.byCourt.length + summary.byGroupMatch.length + summary.byKnockoutMatch.length
  );
}

export function UtilitiesClient({ initialSummary }: UtilitiesClientProps) {
  const [summary, setSummary] = useState(initialSummary);
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

  return (
    <div className="mt-6 space-y-6">
      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="outline" onClick={runCheck} disabled={pending}>
          Check duplicate assignments
        </Button>
        <Button type="button" onClick={runClear} disabled={pending}>
          Clear duplicate assignments
        </Button>
      </div>

      {message ? (
        <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-foreground">
          {message}
        </div>
      ) : null}

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="text-sm font-medium text-foreground">
          Duplicate buckets: {totalDuplicates(summary)}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          A bucket means one duplicated key (for example same stage + same courtId).
        </p>
      </div>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-base font-semibold text-foreground">By Court + Stage</h2>
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
        <h2 className="text-base font-semibold text-foreground">By Group Match + Stage</h2>
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
        <h2 className="text-base font-semibold text-foreground">By Knockout Match + Stage</h2>
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
    </div>
  );
}
