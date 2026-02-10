"use client";

type BestOf3ControlsProps = {
  enabled: boolean;
  onToggle: () => void;
  toggleDisabled?: boolean;
  game: 1 | 2 | 3;
  onGameChange: (game: 1 | 2 | 3) => void;
};

export function BestOf3Controls({
  enabled,
  onToggle,
  toggleDisabled = false,
  game,
  onGameChange,
}: BestOf3ControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={onToggle}
        disabled={toggleDisabled}
        className={`inline-flex items-center rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors ${
          enabled
            ? "border-foreground bg-foreground text-background"
            : "border-border bg-muted text-muted-foreground"
        } ${toggleDisabled ? "opacity-60" : ""}`}
      >
        Best of 3
      </button>
      {enabled ? (
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Game</span>
          <select
            value={String(game)}
            onChange={(event) => onGameChange(Number(event.target.value) as 1 | 2 | 3)}
            className="min-w-[120px] rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none"
          >
            <option value="1">Game 1</option>
            <option value="2">Game 2</option>
            <option value="3">Game 3</option>
          </select>
        </div>
      ) : null}
    </div>
  );
}
