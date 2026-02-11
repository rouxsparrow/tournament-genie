"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { submitRefereeScore, verifyRefereePasscode } from "@/app/referee/actions";
import { BestOf3Controls } from "@/app/referee/components/BestOf3Controls";
import { BottomBar } from "@/app/referee/components/BottomBar";
import { MatchContextBar } from "@/app/referee/components/MatchContextBar";

type CategoryCode = "MD" | "WD" | "XD";
type Stage = "GROUP" | "KNOCKOUT";
type CourtLabel = "P5" | "P6" | "P7" | "P8" | "P9";

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
  court: CourtLabel | null;
};

type KnockoutMatchItem = {
  id: string;
  stage: "KNOCKOUT";
  status: "SCHEDULED" | "COMPLETED" | "WALKOVER";
  categoryCode: CategoryCode;
  series: "A" | "B";
  round: number;
  matchNo: number;
  isBestOf3: boolean;
  homeTeam: Team | null;
  awayTeam: Team | null;
  court: CourtLabel | null;
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
  scoringMode: "SINGLE_GAME_21" | "BEST_OF_3_21";
};

const MAX_SCORE = 30;

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

function clampScore(value: number) {
  return Math.max(0, Math.min(MAX_SCORE, value));
}

function sanitizeScoreInput(value: string) {
  const digits = value.replace(/[^0-9]/g, "");
  if (!digits) return 0;
  return clampScore(Number.parseInt(digits, 10));
}

function shortRoundLabel(match: MatchItem) {
  if (match.stage !== "KNOCKOUT") return "-";
  if (match.round === 1) return "PI";
  if (match.round === 2) return "QF";
  if (match.round === 3) return "SF";
  if (match.round === 4) return "F";
  return `R${match.round}`;
}

function shortMatchMeta(match: MatchItem | null) {
  if (!match) return "Category - - Stage - - Series - - Round -";
  const stage = match.stage === "GROUP" ? "GS" : "KO";
  const series = match.stage === "KNOCKOUT" ? match.series : "-";
  const round = shortRoundLabel(match);
  return `${match.categoryCode} - ${stage} - ${series} - ${round}`;
}

export function RefereeScoreboard({ matches, groups, scoringMode }: RefereeScoreboardProps) {
  const [stage, setStage] = useState<Stage>("GROUP");
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [selectedSeries, setSelectedSeries] = useState<"ALL" | "A" | "B">("ALL");
  const [selectedCourt, setSelectedCourt] = useState<CourtLabel | "">("");
  const [selectedMatchId, setSelectedMatchId] = useState("");
  const [matchStates, setMatchStates] = useState<Record<string, MatchState>>({});
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [submittedForMatchId, setSubmittedForMatchId] = useState<string | null>(null);
  const [submittedMatchSnapshot, setSubmittedMatchSnapshot] = useState<MatchItem | null>(null);
  const [passcodeInput, setPasscodeInput] = useState("");
  const [passcodeError, setPasscodeError] = useState<string | null>(null);
  const [sessionPasscode, setSessionPasscode] = useState("");
  const [pending, startTransition] = useTransition();

  const sessionMatchKey = (matchId: string) => `referee:scoresheet:${matchId}`;
  const selectedMatchIdFromStorage = useSyncExternalStore(
    (callback) => {
      if (typeof window === "undefined") return () => undefined;
      const handler = () => callback();
      window.addEventListener("storage", handler);
      return () => window.removeEventListener("storage", handler);
    },
    () => {
      if (typeof window === "undefined") return "";
      return window.sessionStorage.getItem("referee:selectedMatchId") ?? "";
    },
    () => ""
  );
  const storedPasscode = useSyncExternalStore(
    (callback) => {
      if (typeof window === "undefined") return () => undefined;
      const handler = () => callback();
      window.addEventListener("storage", handler);
      return () => window.removeEventListener("storage", handler);
    },
    () => {
      if (typeof window === "undefined") return "";
      return window.localStorage.getItem("referee:passcode") ?? "";
    },
    () => ""
  );
  const validStoredPasscode = /^\d{4}$/.test(storedPasscode) ? storedPasscode : "";
  const activePasscode = sessionPasscode || validStoredPasscode;
  const passcodeVerified = !!activePasscode;
  const activeSelectedMatchId = selectedMatchId || selectedMatchIdFromStorage;

  const filteredGroups = groups;

  const effectiveGroupId = useMemo(() => {
    if (!selectedGroupId) return "";
    return filteredGroups.some((group) => group.id === selectedGroupId)
      ? selectedGroupId
      : "";
  }, [filteredGroups, selectedGroupId]);

  const availableMatches = useMemo(() => {
    let filtered = matches.filter(
      (match) => match.stage === stage
    );
    if (stage === "GROUP" && effectiveGroupId) {
      filtered = filtered.filter(
        (match) => match.stage === "GROUP" && match.groupId === effectiveGroupId
      );
    }
    if (stage === "KNOCKOUT") {
      filtered = filtered.filter(
        (match) =>
          match.stage === "KNOCKOUT" &&
          (selectedSeries === "ALL" ? true : match.series === selectedSeries)
      );
    }
    if (selectedCourt) {
      filtered = filtered.filter((match) => match.court === selectedCourt);
    }
    return filtered;
  }, [effectiveGroupId, matches, selectedSeries, selectedCourt, stage]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (selectedMatchId) {
      window.sessionStorage.setItem("referee:selectedMatchId", selectedMatchId);
      return;
    }
    window.sessionStorage.removeItem("referee:selectedMatchId");
  }, [selectedMatchId]);

  const selectedMatch = useMemo(
    () => availableMatches.find((match) => match.id === activeSelectedMatchId) ?? null,
    [activeSelectedMatchId, availableMatches]
  );
  const displayMatch =
    selectedMatch ??
    (submittedForMatchId === activeSelectedMatchId ? submittedMatchSnapshot : null);

  const loadStoredState = (matchId: string): MatchState | null => {
    if (typeof window === "undefined") return null;
    const raw = window.sessionStorage.getItem(sessionMatchKey(matchId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as MatchState;
    } catch {
      return null;
    }
  };

  const matchState = displayMatch
    ? matchStates[displayMatch.id] ?? loadStoredState(displayMatch.id) ?? createDefaultState()
    : null;

  const isFinal =
    displayMatch?.stage === "KNOCKOUT" &&
    displayMatch.round === 4 &&
    displayMatch.matchNo === 1;

  const requiresBestOf3 =
    scoringMode === "BEST_OF_3_21" ||
    (isFinal && displayMatch?.stage === "KNOCKOUT" && displayMatch.isBestOf3);

  const bestOf3Enabled = requiresBestOf3 || (matchState?.bestOf3Enabled ?? false);
  const activeGame = bestOf3Enabled ? matchState?.currentGame ?? 1 : 1;
  const activeScore = matchState?.gameScores[activeGame] ?? { home: 0, away: 0 };
  const locked = matchState?.locked ?? false;
  const controlsDisabled = !selectedMatch || locked || pending;
  const actionsHidden = submittedForMatchId === activeSelectedMatchId && !!displayMatch;

  const matchOptions = availableMatches.map((match) => ({
    id: match.id,
    label: `${teamLabel(match.homeTeam)} vs.\n${teamLabel(match.awayTeam)}${
      match.court ? ` (${match.court})` : ""
    }`,
  }));

  const updateMatchState = (id: string, updater: (state: MatchState) => MatchState) => {
    setMatchStates((prev) => {
      const existing = prev[id] ?? loadStoredState(id) ?? createDefaultState();
      const nextState = updater(existing);
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(sessionMatchKey(id), JSON.stringify(nextState));
      }
      return { ...prev, [id]: nextState };
    });
  };

  const clearSelection = () => {
    setSelectedMatchId("");
    setSubmitMessage(null);
    setSubmittedForMatchId(null);
    setSubmittedMatchSnapshot(null);
  };

  const handleStageChange = (value: Stage) => {
    setStage(value);
    clearSelection();
  };

  const handleGroupChange = (value: string) => {
    setSelectedGroupId(value);
    clearSelection();
  };

  const handleSeriesChange = (value: "ALL" | "A" | "B") => {
    setSelectedSeries(value);
    clearSelection();
  };

  const handleCourtChange = (value: CourtLabel | "") => {
    setSelectedCourt(value);
    clearSelection();
  };

  const handleMatchChange = (value: string) => {
    setSelectedMatchId(value);
    setSubmitMessage(null);
    setSubmittedForMatchId(null);
    setSubmittedMatchSnapshot(null);
  };

  const adjustScore = (side: "home" | "away", delta: number) => {
    if (!selectedMatch) return;
    updateMatchState(selectedMatch.id, (state) => {
      const targetGame = bestOf3Enabled ? state.currentGame : 1;
      const currentScore = state.gameScores[targetGame];
      return {
        ...state,
        gameScores: {
          ...state.gameScores,
          [targetGame]: {
            ...currentScore,
            [side]: clampScore(currentScore[side] + delta),
          },
        },
      };
    });
  };

  const setScore = (side: "home" | "away", rawValue: string) => {
    if (!selectedMatch) return;
    updateMatchState(selectedMatch.id, (state) => {
      const targetGame = bestOf3Enabled ? state.currentGame : 1;
      const currentScore = state.gameScores[targetGame];
      return {
        ...state,
        gameScores: {
          ...state.gameScores,
          [targetGame]: {
            ...currentScore,
            [side]: sanitizeScoreInput(rawValue),
          },
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
    setSubmitMessage(null);
  };

  const toggleBestOf3 = () => {
    if (!selectedMatch || requiresBestOf3) return;
    updateMatchState(selectedMatch.id, (state) => ({
      ...state,
      bestOf3Enabled: !state.bestOf3Enabled,
      currentGame: state.bestOf3Enabled ? 1 : state.currentGame,
    }));
  };

  const changeGame = (game: 1 | 2 | 3) => {
    if (!selectedMatch) return;
    updateMatchState(selectedMatch.id, (state) => ({ ...state, currentGame: game }));
  };

  const submitScore = () => {
    if (!selectedMatch || !locked || !matchState || pending) return;
    setSubmitMessage(null);

    startTransition(async () => {
      const result = await submitRefereeScore({
        stage: selectedMatch.stage,
        matchId: selectedMatch.id,
        passcode: activePasscode,
        lockState: locked,
        bestOf3Enabled,
        scores: {
          game1: {
            home: matchState.gameScores[1].home,
            away: matchState.gameScores[1].away,
          },
          ...(bestOf3Enabled
            ? {
                game2: {
                  home: matchState.gameScores[2].home,
                  away: matchState.gameScores[2].away,
                },
                game3: {
                  home: matchState.gameScores[3].home,
                  away: matchState.gameScores[3].away,
                },
              }
            : {}),
        },
      });

      if (result?.error) {
        setSubmitMessage(result.error);
        if (result.error.toLowerCase().includes("passcode")) {
          setSessionPasscode("");
          if (typeof window !== "undefined") {
            window.localStorage.removeItem("referee:passcode");
          }
          setPasscodeError("Passcode invalid. Enter again.");
        }
        return;
      }

      setSubmitMessage("Submitted");
      setSubmittedForMatchId(selectedMatch.id);
      setSubmittedMatchSnapshot(selectedMatch);
    });
  };

  const submitPasscode = () => {
    const normalized = passcodeInput.replace(/\D/g, "").slice(0, 4);
    if (!/^\d{4}$/.test(normalized)) {
      setPasscodeError("Enter a valid 4 digit code.");
      return;
    }
    startTransition(async () => {
      const result = await verifyRefereePasscode(normalized);
      if (result?.error) {
        setPasscodeError(result.error);
        return;
      }
      if (typeof window !== "undefined") {
        window.localStorage.setItem("referee:passcode", normalized);
      }
      setSessionPasscode(normalized);
      setPasscodeInput("");
      setPasscodeError(null);
    });
  };

  if (!passcodeVerified) {
    return (
      <div className="mx-auto max-w-sm rounded-2xl border border-border bg-card p-6">
        <h1 className="text-xl font-semibold text-foreground">Referee Access</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Enter the 4 digit referee passcode.
        </p>
        <input
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          value={passcodeInput}
          onChange={(event) => {
            setPasscodeInput(event.target.value.replace(/\D/g, "").slice(0, 4));
            setPasscodeError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submitPasscode();
            }
          }}
          className="mt-4 h-11 w-full rounded-md border border-input bg-card px-3 text-center text-lg tracking-[0.3em] text-foreground focus:border-ring focus:outline-none"
          maxLength={4}
          aria-label="Referee passcode"
        />
        {passcodeError ? <p className="mt-2 text-sm text-red-600">{passcodeError}</p> : null}
        <Button className="mt-4 w-full" onClick={submitPasscode}>
          Enter
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <MatchContextBar
        stage={stage}
        onStageChange={handleStageChange}
        groups={filteredGroups}
        selectedGroupId={effectiveGroupId}
        onGroupChange={handleGroupChange}
        selectedSeries={selectedSeries}
        onSeriesChange={handleSeriesChange}
        selectedCourt={selectedCourt}
        onCourtChange={handleCourtChange}
        matches={matchOptions}
        selectedMatchId={activeSelectedMatchId}
        onMatchChange={handleMatchChange}
      />

      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">Current Match</p>
            <p className="text-lg font-semibold break-words text-foreground">
              {selectedMatch
                ? `${teamLabel(selectedMatch.homeTeam)} vs ${teamLabel(selectedMatch.awayTeam)}`
                : displayMatch
                  ? `${teamLabel(displayMatch.homeTeam)} vs ${teamLabel(displayMatch.awayTeam)}`
                : "Select match"}
            </p>
            <p className="text-xs text-muted-foreground">{shortMatchMeta(displayMatch)}</p>
            {(selectedMatch?.court ?? displayMatch?.court) ? (
              <p className="text-xs text-muted-foreground">
                Court {selectedMatch?.court ?? displayMatch?.court}
              </p>
            ) : null}
          </div>
          {isFinal || bestOf3Enabled ? (
            <BestOf3Controls
              enabled={bestOf3Enabled}
              onToggle={toggleBestOf3}
              toggleDisabled={requiresBestOf3}
              game={activeGame}
              onGameChange={changeGame}
            />
          ) : null}
        </div>

        <div className="mx-auto mt-8 grid w-fit grid-cols-[auto_auto_auto] grid-rows-[auto_auto_auto_auto] items-center gap-x-6 gap-y-3">
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
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={displayMatch ? String(activeScore.home) : ""}
                onChange={(event) => setScore("home", event.target.value)}
                disabled={controlsDisabled}
                className="h-full w-full bg-transparent text-center text-4xl font-semibold text-white outline-none"
                aria-label="Home score"
              />
            </div>
          </div>

          <div className="col-start-2 row-start-2 flex items-center justify-center text-3xl font-semibold text-foreground">
            -
          </div>

          <div className="col-start-3 row-start-2 flex items-center justify-center">
            <div className="relative flex h-24 w-24 items-center justify-center rounded-xl border-2 border-foreground bg-black text-4xl font-semibold text-white shadow-inner">
              <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-white/25" />
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={displayMatch ? String(activeScore.away) : ""}
                onChange={(event) => setScore("away", event.target.value)}
                disabled={controlsDisabled}
                className="h-full w-full bg-transparent text-center text-4xl font-semibold text-white outline-none"
                aria-label="Away score"
              />
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
            {displayMatch ? teamLabel(displayMatch.homeTeam) : "Home team"}
          </div>
          <div className="col-start-3 row-start-4 text-center text-sm text-muted-foreground">
            {displayMatch ? teamLabel(displayMatch.awayTeam) : "Away team"}
          </div>
        </div>

        {!displayMatch ? (
          <p className="mt-6 text-center text-sm text-muted-foreground">
            Select a match to start scoring.
          </p>
        ) : null}

        {submitMessage ? (
          <p className="mt-4 text-center text-sm text-muted-foreground">{submitMessage}</p>
        ) : null}
      </div>

      <BottomBar
        locked={locked}
        onToggleLock={toggleLock}
        onSubmit={submitScore}
        submitDisabled={!selectedMatch || !locked || pending}
        isSubmitting={pending}
        disabled={!selectedMatch || pending}
        hidden={actionsHidden}
      />
    </div>
  );
}
