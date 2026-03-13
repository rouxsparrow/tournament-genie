"use client";

import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { formatAverageMetric } from "@/lib/format-average-metric";

const NORMAL_ROTATION_MS = 8_000;
const OVERFLOW_ROTATION_MS = 14_000;
const OVERFLOW_HOLD_TOP_MS = 1_500;
const OVERFLOW_SCROLL_MS = 10_000;
const VIEWPORT_BOTTOM_GAP = 20;

type ResultRow = {
  teamId: string;
  globalRank: number;
  teamLabel: string;
  groupLabel: string;
  qualifierSeries: "A" | "B" | null;
  avgPD: number;
};

type CategoryResult = {
  categoryCode: "MD" | "WD" | "XD";
  categoryLabel: string;
  isLocked: boolean;
  rows: ResultRow[];
};

function StatusBadge({ qualifierSeries }: { qualifierSeries: ResultRow["qualifierSeries"] }) {
  if (qualifierSeries === "A") {
    return <Badge variant="default">Series A</Badge>;
  }
  if (qualifierSeries === "B") {
    return <Badge variant="secondary">Series B</Badge>;
  }
  return (
    <Badge
      variant="outline"
      className="border-red-300 text-red-700 dark:border-red-500/50 dark:text-red-300"
    >
      Eliminated
    </Badge>
  );
}

export function GroupStageResultRotator({ results }: { results: CategoryResult[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [tableViewportHeight, setTableViewportHeight] = useState(360);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const timeoutRefs = useRef<number[]>([]);
  const animationFrameRef = useRef<number | null>(null);

  const active = results[index];

  function clearScheduledWork() {
    timeoutRefs.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    timeoutRefs.current = [];
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }

  useEffect(() => {
    function measureViewport() {
      const panel = panelRef.current;
      if (!panel) return;
      const top = panel.getBoundingClientRect().top;
      const availableHeight = Math.floor(window.innerHeight - top - VIEWPORT_BOTTOM_GAP);
      setTableViewportHeight(Math.max(220, availableHeight));
    }

    measureViewport();
    window.addEventListener("resize", measureViewport);
    return () => {
      window.removeEventListener("resize", measureViewport);
    };
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    clearScheduledWork();

    if (viewport) {
      viewport.scrollTop = 0;
    }

    if (paused) {
      return () => clearScheduledWork();
    }

    const advance = () => {
      setIndex((current) => (current + 1) % results.length);
    };
    const isOverflowing = viewport
      ? viewport.scrollHeight - viewport.clientHeight > 1
      : false;

    if (!active.isLocked || active.rows.length === 0 || !viewport || !isOverflowing) {
      if (results.length > 1) {
        timeoutRefs.current.push(window.setTimeout(advance, NORMAL_ROTATION_MS));
      }
      return () => clearScheduledWork();
    }

    const scrollDistance = viewport.scrollHeight - viewport.clientHeight;
    if (scrollDistance <= 1) {
      if (results.length > 1) {
        timeoutRefs.current.push(window.setTimeout(advance, NORMAL_ROTATION_MS));
      }
      return () => clearScheduledWork();
    }

    const animateScroll = (startedAt: number) => {
      const target = viewportRef.current;
      if (!target) return;
      const elapsed = performance.now() - startedAt;
      const progress = Math.min(elapsed / OVERFLOW_SCROLL_MS, 1);
      target.scrollTop = scrollDistance * progress;
      if (progress < 1) {
        animationFrameRef.current = window.requestAnimationFrame(() => animateScroll(startedAt));
      } else {
        animationFrameRef.current = null;
      }
    };

    timeoutRefs.current.push(
      window.setTimeout(() => {
        animationFrameRef.current = window.requestAnimationFrame(() =>
          animateScroll(performance.now())
        );
      }, OVERFLOW_HOLD_TOP_MS)
    );
    if (results.length > 1) {
      timeoutRefs.current.push(window.setTimeout(advance, OVERFLOW_ROTATION_MS));
    }

    return () => clearScheduledWork();
  }, [active.isLocked, active.rows.length, index, paused, results.length, tableViewportHeight]);

  useEffect(() => {
    return () => {
      clearScheduledWork();
    };
  }, []);

  function goTo(nextIndex: number) {
    clearScheduledWork();
    setIndex((nextIndex + results.length) % results.length);
  }

  return (
    <div data-testid="group-stage-rotator" className="space-y-4">
      <div
        data-testid="rotator-header"
        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 lg:flex-nowrap"
      >
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
          <h1 className="text-2xl font-semibold text-foreground whitespace-nowrap">
            Group Stage Result
          </h1>
          <span
            data-testid="current-category"
            className="min-w-0 text-sm font-medium text-foreground md:text-base"
          >
            {active.categoryCode} · {active.categoryLabel}
          </span>
          <span data-testid="slide-indicator" className="text-sm text-muted-foreground">
            {index + 1} / {results.length}
          </span>
        </div>

        <div data-testid="rotator-controls" className="flex items-center gap-2">
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={() => goTo(index - 1)}
          >
            Previous
          </button>
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={() => setPaused((current) => !current)}
          >
            {paused ? "Play" : "Pause"}
          </button>
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={() => goTo(index + 1)}
          >
            Next
          </button>
        </div>
      </div>

      <div
        data-testid={`result-panel-${active.categoryCode}`}
        ref={panelRef}
        className="rounded-xl border border-border p-3 md:p-4"
      >
        {!active.isLocked ? (
          <p className="rounded-lg border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
            Group stage is not locked for this category yet.
          </p>
        ) : active.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No completed group standings available.</p>
        ) : (
          <div
            ref={viewportRef}
            data-testid="table-viewport"
            className="overflow-y-auto overflow-x-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            style={{ maxHeight: tableViewportHeight }}
          >
            <table className="w-full text-sm">
              <thead
                data-testid="table-header"
                className="sticky top-0 z-10 bg-card text-xs uppercase text-muted-foreground"
              >
                <tr>
                  <th className="w-14 py-1 text-left">Rank</th>
                  <th className="py-1 text-left">Team</th>
                  <th className="w-28 py-1 text-left">Group</th>
                  <th className="w-36 py-1 text-left">Status</th>
                  <th className="w-20 py-1 text-right">Avg PD</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {active.rows.map((row) => (
                  <tr
                    key={row.teamId}
                    data-testid={`result-row-${active.categoryCode}-${row.globalRank}`}
                  >
                    <td className="py-1 text-left align-top">{row.globalRank}</td>
                    <td className="py-1 pr-3 text-left">{row.teamLabel}</td>
                    <td className="py-1 text-left whitespace-nowrap">{row.groupLabel}</td>
                    <td className="py-1 text-left">
                      <StatusBadge qualifierSeries={row.qualifierSeries} />
                    </td>
                    <td className="py-1 text-right whitespace-nowrap">
                      {formatAverageMetric(row.avgPD)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
