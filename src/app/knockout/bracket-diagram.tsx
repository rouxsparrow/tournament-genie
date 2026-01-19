type MatchTeam = {
  id: string | null;
  name: string;
  seed?: number | null;
};

type BracketMatch = {
  id: string;
  round: number;
  matchNo: number;
  status: "SCHEDULED" | "COMPLETED" | "WALKOVER";
  winnerTeamId: string | null;
  homeTeam: MatchTeam;
  awayTeam: MatchTeam;
  games: { gameNumber: number; homePoints: number; awayPoints: number }[];
  previousMatches: { round: number; matchNo: number; nextSlot: number | null }[];
};

type BracketDiagramProps = {
  matches: BracketMatch[];
  showPlayIns: boolean;
  maxRound: number;
};

const MATCH_H = 120;
const GAP_QF = 48;
const HEADER_H = 28;
const BOTTOM_PAD = 24;
const QF_STEP = MATCH_H + GAP_QF;
const SF_STEP = QF_STEP * 2;
const SF_OFFSET = QF_STEP / 2;
const FINAL_OFFSET = SF_OFFSET + QF_STEP / 2;

function roundLabel(round: number, maxRound: number) {
  const roundsFromEnd = maxRound - round;
  if (roundsFromEnd === 0) return "Final";
  if (roundsFromEnd === 1) return "Semifinals";
  if (roundsFromEnd === 2) return "Quarterfinals";
  return round === 1 ? "Round 1" : `Round ${round}`;
}

function roundHeader(round: number, maxRound: number) {
  if (round === 1 && maxRound > 3) return "Play-ins";
  return roundLabel(round, maxRound);
}

function statusBadge(status: BracketMatch["status"]) {
  if (status === "COMPLETED" || status === "WALKOVER") {
    return "bg-emerald-500 text-white";
  }
  return "bg-amber-700 text-amber-100";
}

function statusText(status: BracketMatch["status"]) {
  if (status === "COMPLETED" || status === "WALKOVER") return "Completed";
  return "Scheduled";
}

function scoreSummary(games: BracketMatch["games"]) {
  if (!games.length) return "";
  return [...games]
    .sort((a, b) => a.gameNumber - b.gameNumber)
    .map((game) => `${game.homePoints}-${game.awayPoints}`)
    .join(", ");
}

function placeholderLabel(match: BracketMatch, slot: "home" | "away", maxRound: number) {
  const incoming = match.previousMatches.find(
    (prev) => prev.nextSlot === (slot === "home" ? 1 : 2)
  );
  if (incoming && incoming.round === 1 && maxRound > 3) {
    return `Winner of Play-in ${incoming.matchNo}`;
  }
  if (incoming && incoming.round) {
    const label = roundLabel(incoming.round, maxRound);
    if (label === "Quarterfinals") return `Winner of QF${incoming.matchNo}`;
    if (label === "Semifinals") return `Winner of SF${incoming.matchNo}`;
    if (label === "Final") return "Winner of Final";
  }
  return "TBD";
}

function MatchBox({
  match,
  maxRound,
  label,
}: {
  match: BracketMatch;
  maxRound: number;
  label: string;
}) {
  const homeWins = match.winnerTeamId === match.homeTeam.id;
  const awayWins = match.winnerTeamId === match.awayTeam.id;
  const isFinalized = match.status === "COMPLETED" || match.status === "WALKOVER";
  const score = scoreSummary(match.games);

  function rowClass(isWinner: boolean, finalized: boolean) {
    return isWinner && finalized
      ? "bg-gradient-to-r from-emerald-500/25 via-emerald-500/15 to-transparent font-semibold"
      : "bg-muted/40";
  }

  function seedBadge(seed?: number | null) {
    if (!seed) return null;
    return (
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-sm bg-background/70 text-xs font-semibold text-foreground">
        {seed}
      </span>
    );
  }

  const homeLabel = match.homeTeam.id
    ? match.homeTeam.name
    : placeholderLabel(match, "home", maxRound);
  const awayLabel = match.awayTeam.id
    ? match.awayTeam.name
    : placeholderLabel(match, "away", maxRound);

  return (
    <div className="h-[120px] overflow-hidden rounded-md border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b border-border px-2 py-1">
        <span className="text-[11px] font-semibold text-muted-foreground">
          {label}
        </span>
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusBadge(
            match.status
          )}`}
        >
          {statusText(match.status)}
        </span>
        {score ? (
          <span className="text-[11px] tabular-nums text-muted-foreground">
            Score: {score}
          </span>
        ) : null}
      </div>
      <div className="divide-y divide-border text-sm">
        <div className={`flex items-center gap-2 px-2 py-3 ${rowClass(homeWins, isFinalized)}`}>
          {seedBadge(match.homeTeam.seed)}
          <span className="truncate">{homeLabel}</span>
        </div>
        <div className={`flex items-center gap-2 px-2 py-3 ${rowClass(awayWins, isFinalized)}`}>
          {seedBadge(match.awayTeam.seed)}
          <span className="truncate">{awayLabel}</span>
        </div>
      </div>
    </div>
  );
}

function columnTop(index: number, baseOffset: number, step: number) {
  return baseOffset + index * step;
}

export function BracketDiagram({ matches, showPlayIns, maxRound }: BracketDiagramProps) {
  const byRound = new Map<number, BracketMatch[]>();
  for (const match of matches) {
    const list = byRound.get(match.round) ?? [];
    list.push(match);
    byRound.set(match.round, list);
  }

  const roundEntries = Array.from(byRound.entries())
    .map(([round, list]) => ({
      round,
      matches: [...list].sort((a, b) => a.matchNo - b.matchNo),
      count: list.length,
    }))
    .sort((a, b) => a.round - b.round);

  const playIn =
    showPlayIns && maxRound > 3
      ? roundEntries.find((entry) => entry.round === 1) ?? roundEntries[0]
      : null;
  const qfRound =
    maxRound >= 3
      ? roundEntries.find((entry) => entry.round === maxRound - 2) ??
        roundEntries.find((entry) => entry.round === 1) ??
        roundEntries[0]
      : null;
  const sfRound =
    roundEntries.find((entry) => entry.round === maxRound - 1) ??
    roundEntries.find((entry) => entry.round === 2) ??
    roundEntries[1] ??
    roundEntries[0];
  const finalRound =
    roundEntries.find((entry) => entry.round === maxRound) ??
    roundEntries[2] ??
    roundEntries[roundEntries.length - 1];

  const height = HEADER_H + MATCH_H * 4 + GAP_QF * 3 + BOTTOM_PAD;
  const columnWidth = 280;
  const connectorWidth = 80;
  const playInWidth = 0;

  const qfTop = HEADER_H;
  const sfTop = HEADER_H + SF_OFFSET;
  const finalTop = HEADER_H + FINAL_OFFSET;

  const qfMatches = qfRound?.matches ?? [];
  const sfMatches = sfRound?.matches ?? [];
  const finalMatches = finalRound?.matches ?? [];

  const showQuarterfinals = maxRound >= 3;
  const qfX = playInWidth;
  const sfX = showQuarterfinals ? qfX + columnWidth + connectorWidth : playInWidth;
  const finalX = sfX + columnWidth + connectorWidth;
  const qfRight = qfX + columnWidth;
  const sfLeft = sfX;
  const sfRight = sfX + columnWidth;
  const finalLeft = finalX;
  const midXQF = qfRight + connectorWidth / 2;
  const midXSF = sfRight + connectorWidth / 2;
  const qfCenters = qfMatches.map((_, index) => columnTop(index, qfTop, QF_STEP) + MATCH_H / 2);
  const sfCenters = sfMatches.map((_, index) => columnTop(index, sfTop, SF_STEP) + MATCH_H / 2);
  const finalCenter = FINAL_OFFSET + MATCH_H / 2;

  return (
    <div className="overflow-x-auto">
      {showPlayIns && playIn ? (
        <div className="mb-6">
          <p className="text-xs font-semibold text-muted-foreground">
            {roundHeader(playIn.round, maxRound)}
          </p>
          <div className="mt-3 flex flex-wrap gap-4">
            {playIn.matches.map((match, index) => (
              <div key={match.id} className="w-[280px]">
                <MatchBox match={match} maxRound={maxRound} label={`PI${index + 1}`} />
              </div>
            ))}
          </div>
          <div className="mt-5 h-px w-full bg-border/70" />
        </div>
      ) : null}
      <div className="relative min-w-[980px]" style={{ height: `${height}px` }}>

        {showQuarterfinals ? (
          <div
            className="absolute top-0 w-[280px]"
            style={{ left: `${qfX}px`, height: `${height}px` }}
          >
            <p className="text-xs font-semibold text-muted-foreground">
              Quarterfinals
            </p>
            {qfMatches.map((match, index) => (
              <div
                key={match.id}
                style={{
                  position: "absolute",
                  top: `${columnTop(index, qfTop, QF_STEP)}px`,
                  width: "100%",
                }}
              >
                <MatchBox match={match} maxRound={maxRound} label={`QF${index + 1}`} />
              </div>
            ))}
          </div>
        ) : null}

        <div
          className="absolute top-0 w-[280px]"
          style={{ left: `${sfX}px`, height: `${height}px` }}
        >
          <p className="text-xs font-semibold text-muted-foreground">
            Semifinals
          </p>
          {sfMatches.map((match, index) => (
            <div
              key={match.id}
              style={{
                position: "absolute",
                top: `${columnTop(index, sfTop, SF_STEP)}px`,
                width: "100%",
              }}
            >
              <MatchBox match={match} maxRound={maxRound} label={`SF${index + 1}`} />
            </div>
          ))}
        </div>

        <div
          className="absolute top-0 w-[280px]"
          style={{ left: `${finalX}px`, height: `${height}px` }}
        >
          <p className="text-xs font-semibold text-muted-foreground">Final</p>
          {finalMatches.map((match) => (
            <div
              key={match.id}
              style={{
                position: "absolute",
                top: `${finalTop}px`,
                width: "100%",
              }}
            >
              <MatchBox match={match} maxRound={maxRound} label="Final" />
            </div>
          ))}
        </div>

        <svg
          className="absolute inset-0 pointer-events-none"
          width="100%"
          height={height}
        >
          {showQuarterfinals && qfCenters.length >= 4 && sfCenters.length >= 2 ? (
            <>
              <path
                d={`M ${qfRight} ${qfCenters[0]} H ${midXQF} V ${sfCenters[0]} H ${sfLeft}`}
                stroke="rgb(113 113 122 / 0.7)"
                strokeWidth="2"
                fill="none"
              />
              <path
                d={`M ${qfRight} ${qfCenters[1]} H ${midXQF} V ${sfCenters[0]} H ${sfLeft}`}
                stroke="rgb(113 113 122 / 0.7)"
                strokeWidth="2"
                fill="none"
              />
              <path
                d={`M ${qfRight} ${qfCenters[2]} H ${midXQF} V ${sfCenters[1]} H ${sfLeft}`}
                stroke="rgb(113 113 122 / 0.7)"
                strokeWidth="2"
                fill="none"
              />
              <path
                d={`M ${qfRight} ${qfCenters[3]} H ${midXQF} V ${sfCenters[1]} H ${sfLeft}`}
                stroke="rgb(113 113 122 / 0.7)"
                strokeWidth="2"
                fill="none"
              />
              {sfCenters.length >= 2 ? (
                <>
                  <path
                    d={`M ${sfRight} ${sfCenters[0]} H ${midXSF} V ${finalCenter} H ${finalLeft}`}
                    stroke="rgb(113 113 122 / 0.7)"
                    strokeWidth="2"
                    fill="none"
                  />
                  <path
                    d={`M ${sfRight} ${sfCenters[1]} H ${midXSF} V ${finalCenter} H ${finalLeft}`}
                    stroke="rgb(113 113 122 / 0.7)"
                    strokeWidth="2"
                    fill="none"
                  />
                </>
              ) : null}
            </>
          ) : sfCenters.length >= 2 ? (
            <>
              <path
                d={`M ${sfRight} ${sfCenters[0]} H ${midXSF} V ${finalCenter} H ${finalLeft}`}
                stroke="rgb(113 113 122 / 0.7)"
                strokeWidth="2"
                fill="none"
              />
              <path
                d={`M ${sfRight} ${sfCenters[1]} H ${midXSF} V ${finalCenter} H ${finalLeft}`}
                stroke="rgb(113 113 122 / 0.7)"
                strokeWidth="2"
                fill="none"
              />
            </>
          ) : null}
        </svg>
      </div>
    </div>
  );
}
