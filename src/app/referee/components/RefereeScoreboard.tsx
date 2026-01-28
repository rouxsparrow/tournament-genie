"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { BestOf3Controls } from "@/app/referee/components/BestOf3Controls";
import { BottomBar } from "@/app/referee/components/BottomBar";
import { MatchContextBar } from "@/app/referee/components/MatchContextBar";

type CategoryCode = "MD" | "WD" | "XD";

type Stage = "GROUP" | "KNOCKOUT";

type TeamMember = {
  player: { name: string };
};

type Team = {
  id: string;
  name: string;
  members: TeamMember[];
};

type GroupMatchItem = {
  id: string;
  stage: "GROUP";
  status: "SCHEDULED" | "COMPLETED" | "WALKOVER";
  categoryCode: CategoryCode;
  groupId: string;
  groupName: string;
  homeTeam: Team | null;
  awayTeam: Team | null;
};

type KnockoutMatchItem = {
  id: string;
  stage: "KNOCKOUT";
  status: "SCHEDULED" | "COMPLETED" | "WALKOVER";
  categoryCode: CategoryCode;
  series: "A" | "B";
  round: number;
  matchNo: number;
  homeTeam: Team | null;
  awayTeam: Team | null;
};

type MatchItem = GroupMatchItem | KnockoutMatchItem;

type GroupOption = {
  id: string;
  name: string;
  categoryCode: CategoryCode;
};

type MatchState = {
  locked: boolean;
  bestOf3Enabled: boolean;
  currentGame: 1 | 2 | 3;
  gameScores: Record<1 | 2 | 3, { home: number; away: number }>;
};

type RefereeScoreboardProps = {
  matches: MatchItem[];
  groups: GroupOption[];
};

const categories: CategoryCode[] = ["MD", "WD", "XD"];

function teamLabel(team: Team | null) {
  if (!team) return "TBD";
  if (team.name) return team.name;
  const names = team.members.map((member) => member.player.name);
  return names.length === 2 ? `${names[0]} / ${names[1]}` : "Unnamed team";
}

function createDefaultState(): MatchState {
  return {
    locked: false,
    bestOf3Enabled: false,
    currentGame: 1,
    gameScores: {
      1: { home: 0, away: 0 },
      2: { home: 0, away: 0 },
      3: { home: 0, away: 0 },
    },
  };
}

export function RefereeScoreboard({ matches, groups }: RefereeScoreboardProps) {
  const [selectedCategory, setSelectedCategory] = useState<CategoryCode>("MD");
  const [stage, setStage] = useState<Stage>("GROUP");
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [selectedSeries, setSelectedSeries] = useState<"A" | "B">("A");
  const [selectedMatchId, setSelectedMatchId] = useState("");
  const [matchStates, setMatchStates] = useState<Record<string, MatchState>>({});
  const sessionMatchKey = (matchId: string) => `referee:scoresheet:${matchId}`;
  const sessionSelectedKey = "referee:selectedMatchId";

  const filteredGroups = useMemo(
    () => groups.filter((group) => group.categoryCode === selectedCategory),
    [groups, selectedCategory]
  );

  useEffect(() => {
    if (!selectedGroupId) return;
    const stillValid = filteredGroups.some((group) => group.id === selectedGroupId);
    if (!stillValid) setSelectedGroupId("");
  }, [filteredGroups, selectedGroupId]);

  const availableMatches = useMemo(() => {
    let filtered = matches.filter(
      (match) => match.categoryCode === selectedCategory && match.stage === stage
    );
    if (stage === "GROUP" && selectedGroupId) {
      filtered = filtered.filter(
        (match) => match.stage === "GROUP" && match.groupId === selectedGroupId
      );
    }
    if (stage === "KNOCKOUT") {
      filtered = filtered.filter(
        (match) => match.stage === "KNOCKOUT" && match.series === selectedSeries
      );
    }
    return filtered;
  }, [matches, selectedCategory, selectedGroupId, selectedSeries, stage]);

  useEffect(() => {
    setSelectedMatchId("");
  }, [selectedCategory, selectedGroupId, selectedSeries, stage]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const storedMatchId = window.sessionStorage.getItem(sessionSelectedKey) ?? "";
    if (!storedMatchId) return;
    setSelectedMatchId(storedMatchId);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (selectedMatchId) {
      window.sessionStorage.setItem(sessionSelectedKey, selectedMatchId);
    }
  }, [selectedMatchId]);

  const selectedMatch = useMemo(
    () => availableMatches.find((match) => match.id === selectedMatchId) ?? null,
    [availableMatches, selectedMatchId]
  );

  useEffect(() => {
    if (!selectedMatch) return;
    setMatchStates((prev) => {
      if (prev[selectedMatch.id]) return prev;
      if (typeof window !== "undefined") {
        const stored = window.sessionStorage.getItem(sessionMatchKey(selectedMatch.id));
        if (stored) {
          try {
            const parsed = JSON.parse(stored) as MatchState;
            return { ...prev, [selectedMatch.id]: parsed };
          } catch {
            // Ignore invalid stored state.
          }
        }
      }
      return { ...prev, [selectedMatch.id]: createDefaultState() };
    });
  }, [selectedMatch]);

  const matchState = selectedMatch ? matchStates[selectedMatch.id] : null;
  const isFinal =
    selectedMatch?.stage === "KNOCKOUT" &&
    selectedMatch.round === 4 &&
    selectedMatch.matchNo === 1;
  const bestOf3Enabled = matchState?.bestOf3Enabled ?? false;
  const activeGame = isFinal && bestOf3Enabled ? matchState?.currentGame ?? 1 : 1;
  const activeScore = matchState?.gameScores[activeGame] ?? { home: 0, away: 0 };
  const locked = matchState?.locked ?? false;
  const controlsDisabled = !selectedMatch || locked;

  const matchOptions = availableMatches.map((match) => ({
    id: match.id,
    label: `${teamLabel(match.homeTeam)} vs ${teamLabel(match.awayTeam)}`,
  }));

  const updateMatchState = (id: string, updater: (state: MatchState) => MatchState) => {
    setMatchStates((prev) => {
      const existing = prev[id] ?? createDefaultState();
      const nextState = updater(existing);
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(sessionMatchKey(id), JSON.stringify(nextState));
      }
      return { ...prev, [id]: nextState };
    });
  };

  const adjustScore = (side: "home" | "away", delta: number) => {
    if (!selectedMatch) return;
    updateMatchState(selectedMatch.id, (state) => {
      const targetGame = isFinal && state.bestOf3Enabled ? state.currentGame : 1;
      const currentScore = state.gameScores[targetGame];
      const nextValue = Math.max(0, currentScore[side] + delta);
      return {
        ...state,
        gameScores: {
          ...state.gameScores,
          [targetGame]: {
            ...currentScore,
            [side]: nextValue,
          },
        },
      };
    });
  };

  const resetScore = () => {
    if (!selectedMatch) return;
    updateMatchState(selectedMatch.id, (state) => {
      const targetGame = isFinal && state.bestOf3Enabled ? state.currentGame : 1;
      return {
        ...state,
        gameScores: {
          ...state.gameScores,
          [targetGame]: { home: 0, away: 0 },
        },
      };
    });
  };

  const toggleLock = () => {
    if (!selectedMatch) return;
    updateMatchState(selectedMatch.id, (state) => ({
      ...state,
      locked: !state.locked,
    }));
  };

  const toggleBestOf3 = () => {
    if (!selectedMatch) return;
    updateMatchState(selectedMatch.id, (state) => {
      const enabled = !state.bestOf3Enabled;
      return {
        ...state,
        bestOf3Enabled: enabled,
        currentGame: enabled ? state.currentGame : 1,
      };
    });
  };

  const changeGame = (game: 1 | 2 | 3) => {
    if (!selectedMatch) return;
    updateMatchState(selectedMatch.id, (state) => ({
      ...state,
      currentGame: game,
    }));
  };

  return (
    <div className="space-y-6">
      <MatchContextBar
        categories={categories}
        selectedCategory={selectedCategory}
        onCategoryChange={setSelectedCategory}
        stage={stage}
        onStageChange={setStage}
        groups={filteredGroups}
        selectedGroupId={selectedGroupId}
        onGroupChange={setSelectedGroupId}
        selectedSeries={selectedSeries}
        onSeriesChange={setSelectedSeries}
        matches={matchOptions}
        selectedMatchId={selectedMatchId}
        onMatchChange={setSelectedMatchId}
      />

      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">Current Match</p>
            <p className="text-lg font-semibold text-foreground break-words">
              {selectedMatch
                ? `${teamLabel(selectedMatch.homeTeam)} vs ${teamLabel(
                    selectedMatch.awayTeam
                  )}`
                : "Select match"}
            </p>
          </div>
          {isFinal ? (
            <BestOf3Controls
              enabled={bestOf3Enabled}
              onToggle={toggleBestOf3}
              game={activeGame}
              onGameChange={changeGame}
            />
          ) : null}
        </div>

        {/* Layout contract: keep 3-column grid; team columns are centered vertical stacks. */}
        <div className="mt-8 grid w-fit grid-cols-[auto_auto_auto] grid-rows-[auto_auto_auto_auto] items-center gap-x-6 gap-y-3 mx-auto">
          <Button
            type="button"
            variant="outline"
            className="col-start-1 row-start-1 h-12 w-12 justify-self-center text-xl"
            onClick={() => adjustScore("home", 1)}
            disabled={controlsDisabled}
          >
            +
          </Button>
          <Button
            type="button"
            variant="outline"
            className="col-start-3 row-start-1 h-12 w-12 justify-self-center text-xl"
            onClick={() => adjustScore("away", 1)}
            disabled={controlsDisabled}
          >
            +
          </Button>

          <div className="col-start-1 row-start-2 flex items-center justify-center">
            <div className="relative flex h-24 w-24 items-center justify-center rounded-xl border-2 border-foreground bg-black text-4xl font-semibold text-white shadow-inner">
              <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-white/25" />
              {selectedMatch ? activeScore.home : "--"}
            </div>
          </div>
          <div className="col-start-2 row-start-2 flex items-center justify-center text-3xl font-semibold text-foreground">
            -
          </div>
          <div className="col-start-3 row-start-2 flex items-center justify-center">
            <div className="relative flex h-24 w-24 items-center justify-center rounded-xl border-2 border-foreground bg-black text-4xl font-semibold text-white shadow-inner">
              <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-white/25" />
              {selectedMatch ? activeScore.away : "--"}
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            className="col-start-1 row-start-3 h-12 w-12 justify-self-center text-xl"
            onClick={() => adjustScore("home", -1)}
            disabled={controlsDisabled}
          >
            -
          </Button>
          <Button
            type="button"
            variant="outline"
            className="col-start-3 row-start-3 h-12 w-12 justify-self-center text-xl"
            onClick={() => adjustScore("away", -1)}
            disabled={controlsDisabled}
          >
            -
          </Button>

          <div className="col-start-1 row-start-4 text-center text-sm text-muted-foreground">
            {selectedMatch ? teamLabel(selectedMatch.homeTeam) : "Home team"}
          </div>
          <div className="col-start-3 row-start-4 text-center text-sm text-muted-foreground">
            {selectedMatch ? teamLabel(selectedMatch.awayTeam) : "Away team"}
          </div>
        </div>

        {!selectedMatch ? (
          <p className="mt-6 text-center text-sm text-muted-foreground">
            Select a match to start scoring.
          </p>
        ) : null}
      </div>

      <BottomBar
        locked={locked}
        onToggleLock={toggleLock}
        onReset={resetScore}
        disabled={!selectedMatch}
      />
    </div>
  );
}
