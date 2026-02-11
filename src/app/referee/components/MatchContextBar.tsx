"use client";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
  selectedSeries: "ALL" | "A" | "B";
  onSeriesChange: (value: "ALL" | "A" | "B") => void;
  selectedCourt: "P5" | "P6" | "P7" | "P8" | "P9" | "";
  onCourtChange: (value: "P5" | "P6" | "P7" | "P8" | "P9" | "") => void;
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
  selectedCourt,
  onCourtChange,
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
            Select a match, lock the sheet, and submit official score updates.
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

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="col-span-2 md:col-span-1">
          <label className="text-xs font-medium text-muted-foreground">Court</label>
          <select
            value={selectedCourt}
            onChange={(event) =>
              onCourtChange(
                event.target.value as "P5" | "P6" | "P7" | "P8" | "P9" | ""
              )
            }
            className="mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none"
          >
            <option value="">All courts</option>
            <option value="P5">P5</option>
            <option value="P6">P6</option>
            <option value="P7">P7</option>
            <option value="P8">P8</option>
            <option value="P9">P9</option>
          </select>
        </div>

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
              onChange={(event) =>
                onSeriesChange(event.target.value as "ALL" | "A" | "B")
              }
              className="mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none"
            >
              <option value="ALL">All Series</option>
              <option value="A">Series A</option>
              <option value="B">Series B</option>
            </select>
          </div>
        )}

        <div className="col-span-2 min-w-0 md:col-span-2">
          <label className="text-xs font-medium text-muted-foreground">Match</label>
          <div className="mt-1">
            <Select
              value={selectedMatchId}
              onValueChange={onMatchChange}
              disabled={!hasMatches}
            >
              <SelectTrigger className="h-14 w-full min-w-0 md:h-10 [&>span]:block [&>span]:max-w-full [&>span]:truncate [&>span]:text-left">
                <SelectValue
                  placeholder={hasMatches ? "Select match" : "No scheduled matches"}
                  className="truncate"
                />
              </SelectTrigger>
              <SelectContent>
                {matches.map((match) => (
                  <SelectItem key={match.id} value={match.id} className="max-w-[85vw] truncate md:max-w-none">
                    {match.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </div>
  );
}
