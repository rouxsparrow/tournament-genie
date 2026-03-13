"use client";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Stage = "GROUP" | "KNOCKOUT";

type MatchOption = {
  id: string;
  label: string;
};

type MatchContextBarProps = {
  stage: Stage;
  onStageChange: (value: Stage) => void;
  selectedCourt: "P5" | "P6" | "P7" | "P8" | "P9" | "";
  onCourtChange: (value: "P5" | "P6" | "P7" | "P8" | "P9" | "") => void;
  lockedCourt: "P5" | "P6" | "P7" | "P8" | "P9" | "";
  onToggleCourtLock: () => void;
  canLockCourt?: boolean;
  matches: MatchOption[];
  selectedMatchId: string;
  onMatchChange: (value: string) => void;
  disabled?: boolean;
};

export function MatchContextBar({
  stage,
  onStageChange,
  selectedCourt,
  onCourtChange,
  lockedCourt,
  onToggleCourtLock,
  canLockCourt = false,
  matches,
  selectedMatchId,
  onMatchChange,
  disabled = false,
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
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="referee-court" className="text-xs font-medium text-muted-foreground">
              Court
            </label>
            {lockedCourt ? (
              <span className="text-xs font-medium text-foreground">Court locked to {lockedCourt}</span>
            ) : null}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <select
              id="referee-court"
              value={selectedCourt}
              disabled={disabled || !!lockedCourt}
              onChange={(event) =>
                onCourtChange(event.target.value as "P5" | "P6" | "P7" | "P8" | "P9" | "")
              }
              className="min-w-0 flex-1 rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none"
            >
              <option value="">All courts</option>
              <option value="P5">P5</option>
              <option value="P6">P6</option>
              <option value="P7">P7</option>
              <option value="P8">P8</option>
              <option value="P9">P9</option>
            </select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onToggleCourtLock}
              disabled={disabled || (!lockedCourt && !canLockCourt)}
            >
              {lockedCourt ? "Unlock Court" : "Lock Court"}
            </Button>
          </div>
        </div>

        <div>
          <label htmlFor="referee-stage" className="text-xs font-medium text-muted-foreground">
            Stage
          </label>
          <select
            id="referee-stage"
            value={stage}
            disabled={disabled}
            onChange={(event) => onStageChange(event.target.value as Stage)}
            className="mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none"
          >
            <option value="GROUP">Group Stage</option>
            <option value="KNOCKOUT">Knockout</option>
          </select>
        </div>

        <div className="col-span-2 min-w-0">
          <label className="text-xs font-medium text-muted-foreground">Match</label>
          <div className="mt-1">
            <Select value={selectedMatchId} onValueChange={onMatchChange} disabled={!hasMatches || disabled}>
              <SelectTrigger className="h-14 w-full min-w-0 md:h-10 [&>span]:block [&>span]:max-w-full [&>span]:text-left [&>span]:whitespace-pre-line md:[&>span]:truncate md:[&>span]:whitespace-nowrap">
                <SelectValue
                  placeholder={hasMatches ? "Select match" : "No scheduled matches"}
                  className="whitespace-pre-line md:truncate"
                />
              </SelectTrigger>
              <SelectContent>
                {matches.map((match) => (
                  <SelectItem
                    key={match.id}
                    value={match.id}
                    className="max-w-[85vw] whitespace-pre-line leading-tight md:max-w-none md:whitespace-nowrap"
                  >
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
