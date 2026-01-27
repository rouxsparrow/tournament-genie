"use client";

import { Button } from "@/components/ui/button";

type CategoryCode = "MD" | "WD" | "XD";

type Stage = "GROUP" | "KNOCKOUT";

type GroupOption = {
  id: string;
  name: string;
  categoryCode: CategoryCode;
};

type MatchOption = {
  id: string;
  label: string;
};

type MatchContextBarProps = {
  categories: CategoryCode[];
  selectedCategory: CategoryCode;
  onCategoryChange: (value: CategoryCode) => void;
  stage: Stage;
  onStageChange: (value: Stage) => void;
  groups: GroupOption[];
  selectedGroupId: string;
  onGroupChange: (value: string) => void;
  selectedSeries: "A" | "B";
  onSeriesChange: (value: "A" | "B") => void;
  matches: MatchOption[];
  selectedMatchId: string;
  onMatchChange: (value: string) => void;
};

export function MatchContextBar({
  categories,
  selectedCategory,
  onCategoryChange,
  stage,
  onStageChange,
  groups,
  selectedGroupId,
  onGroupChange,
  selectedSeries,
  onSeriesChange,
  matches,
  selectedMatchId,
  onMatchChange,
}: MatchContextBarProps) {
  const hasMatches = matches.length > 0;

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Referee Scoresheet</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Select a match and update the live score locally.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {categories.map((category) => (
            <Button
              key={category}
              variant={category === selectedCategory ? "default" : "outline"}
              size="sm"
              onClick={() => onCategoryChange(category)}
            >
              {category}
            </Button>
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Stage</label>
          <select
            value={stage}
            onChange={(event) => onStageChange(event.target.value as Stage)}
            className="mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none"
          >
            <option value="GROUP">Group Stage</option>
            <option value="KNOCKOUT">Knockout</option>
          </select>
        </div>

        {stage === "GROUP" ? (
          <div>
            <label className="text-xs font-medium text-muted-foreground">Group</label>
            <select
              value={selectedGroupId}
              onChange={(event) => onGroupChange(event.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none"
            >
              <option value="">All groups</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  Group {group.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div>
            <label className="text-xs font-medium text-muted-foreground">Series</label>
            <select
              value={selectedSeries}
              onChange={(event) => onSeriesChange(event.target.value as "A" | "B")}
              className="mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none"
            >
              <option value="A">Series A</option>
              <option value="B">Series B</option>
            </select>
          </div>
        )}

        <div className="md:col-span-2">
          <label className="text-xs font-medium text-muted-foreground">Match</label>
          <select
            value={selectedMatchId}
            onChange={(event) => onMatchChange(event.target.value)}
            className="mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none"
          >
            <option value="">
              {hasMatches ? "Select match" : "No scheduled matches"}
            </option>
            {matches.map((match) => (
              <option key={match.id} value={match.id}>
                {match.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
