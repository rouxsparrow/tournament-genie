"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { submitRefereeScore } from "@/app/referee/actions";
import { loginReferee, logoutReferee } from "@/app/referee/auth-actions";
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
  status: "SCHEDULED" | "COMPLETED";
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
  status: "SCHEDULED" | "COMPLETED";
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

type MatchState = {
  locked: boolean;
  bestOf3Enabled: boolean;
  currentGame: 1 | 2 | 3;
  gameScores: Record<1 | 2 | 3, { home: number; away: number }>;
};

type RefereeScoreboardProps = {
  matches: MatchItem[];
  scoringMode: "SINGLE_GAME_21" | "BEST_OF_3_21";
  isAuthenticated: boolean;
  refereeDisplayName: string | null;
};

const MAX_SCORE = 30;
const REFEREE_STAGE_FILTER_KEY = "referee:filter:stage";
const REFEREE_COURT_FILTER_KEY = "referee:filter:court";
const REFEREE_DISPLAY_SWAP_KEY_PREFIX = "referee:displaySwap:";

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

export function RefereeScoreboard({
  matches,
  scoringMode,
  isAuthenticated,
  refereeDisplayName,
}: RefereeScoreboardProps) {
  const router = useRouter();
  const [matchesState, setMatchesState] = useState<MatchItem[]>(matches);
  const [stage, setStage] = useState<Stage>("GROUP");
  const [selectedCourt, setSelectedCourt] = useState<CourtLabel | "">("");
  const [selectedMatchId, setSelectedMatchId] = useState("");
  const [matchStates, setMatchStates] = useState<Record<string, MatchState>>({});
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [submittedForMatchId, setSubmittedForMatchId] = useState<string | null>(null);
  const [submittedMatchSnapshot, setSubmittedMatchSnapshot] = useState<MatchItem | null>(null);
  const [isSidesSwapped, setIsSidesSwapped] = useState(false);
  const [usernameInput, setUsernameInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [sessionAuthenticated, setSessionAuthenticated] = useState(isAuthenticated);
  const [submitPending, startSubmitTransition] = useTransition();
  const [authPending, startAuthTransition] = useTransition();

  useEffect(() => {
    setSessionAuthenticated(isAuthenticated);
  }, [isAuthenticated]);

  useEffect(() => {
    setMatchesState(matches);
  }, [matches]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const storedStage = window.sessionStorage.getItem(REFEREE_STAGE_FILTER_KEY);
    if (storedStage === "GROUP" || storedStage === "KNOCKOUT") {
      setStage(storedStage);
    }

    const storedCourt = window.sessionStorage.getItem(REFEREE_COURT_FILTER_KEY);
    if (!storedCourt || ["P5", "P6", "P7", "P8", "P9"].includes(storedCourt)) {
      setSelectedCourt((storedCourt ?? "") as CourtLabel | "");
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(REFEREE_STAGE_FILTER_KEY, stage);
  }, [stage]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (selectedCourt) {
      window.sessionStorage.setItem(REFEREE_COURT_FILTER_KEY, selectedCourt);
      return;
    }
    window.sessionStorage.removeItem(REFEREE_COURT_FILTER_KEY);
  }, [selectedCourt]);

  const sessionMatchKey = (matchId: string) => `referee:scoresheet:${matchId}`;
  const swapKey = (matchId: string) => `${REFEREE_DISPLAY_SWAP_KEY_PREFIX}${matchId}`;
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
  const activeSelectedMatchId = selectedMatchId || selectedMatchIdFromStorage;

  const availableMatches = useMemo(() => {
    let filtered = matchesState.filter((match) => match.stage === stage);
    if (selectedCourt) {
      filtered = filtered.filter((match) => match.court === selectedCourt);
    }
    return filtered;
  }, [matchesState, selectedCourt, stage]);

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
    selectedMatch ?? (submittedForMatchId === activeSelectedMatchId ? submittedMatchSnapshot : null);
  const displayedMatchIdForSwap = displayMatch?.id ?? "";

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!displayedMatchIdForSwap) {
      setIsSidesSwapped(false);
      return;
    }
    setIsSidesSwapped(window.sessionStorage.getItem(swapKey(displayedMatchIdForSwap)) === "1");
  }, [displayedMatchIdForSwap]);

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

  const isFinal = displayMatch?.stage === "KNOCKOUT" && displayMatch.round === 4 && displayMatch.matchNo === 1;

  const requiresBestOf3 =
    scoringMode === "BEST_OF_3_21" ||
    (isFinal && displayMatch?.stage === "KNOCKOUT" && displayMatch.isBestOf3);

  const bestOf3Enabled = requiresBestOf3 || (matchState?.bestOf3Enabled ?? false);
  const activeGame = bestOf3Enabled ? matchState?.currentGame ?? 1 : 1;
  const activeScore = matchState?.gameScores[activeGame] ?? { home: 0, away: 0 };
  const leftScoreSide: "home" | "away" = isSidesSwapped ? "away" : "home";
  const rightScoreSide: "home" | "away" = isSidesSwapped ? "home" : "away";
  const leftScore = leftScoreSide === "home" ? activeScore.home : activeScore.away;
  const rightScore = rightScoreSide === "home" ? activeScore.home : activeScore.away;
  const leftTeam = isSidesSwapped ? displayMatch?.awayTeam ?? null : displayMatch?.homeTeam ?? null;
  const rightTeam = isSidesSwapped ? displayMatch?.homeTeam ?? null : displayMatch?.awayTeam ?? null;
  const locked = matchState?.locked ?? false;
  const controlsDisabled =
    !sessionAuthenticated || !selectedMatch || locked || submitPending || authPending;
  const actionsHidden = submittedForMatchId === activeSelectedMatchId && !!displayMatch;

  const matchOptions = availableMatches.map((match) => ({
    id: match.id,
    label: `${teamLabel(match.homeTeam)} vs.\n${teamLabel(match.awayTeam)}${match.court ? ` (${match.court})` : ""}`,
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

  const toggleDisplaySides = () => {
    if (!selectedMatch || controlsDisabled || typeof window === "undefined") return;
    setIsSidesSwapped((previous) => {
      const next = !previous;
      window.sessionStorage.setItem(swapKey(selectedMatch.id), next ? "1" : "0");
      return next;
    });
  };

  const submitScore = () => {
    if (!sessionAuthenticated || !selectedMatch || !locked || !matchState || submitPending) return;
    setSubmitMessage(null);

    startSubmitTransition(async () => {
      const result = await submitRefereeScore({
        stage: selectedMatch.stage,
        matchId: selectedMatch.id,
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

      if (result && "error" in result && result.error) {
        setSubmitMessage(result.error);
        if (result.error.toLowerCase().includes("referee access required")) {
          setSessionAuthenticated(false);
          setAuthError("Session expired. Please sign in again.");
        }
        return;
      }

      setSubmitMessage("Submitted");
      setSubmittedForMatchId(selectedMatch.id);
      setSubmittedMatchSnapshot(selectedMatch);
      if (result && "ok" in result && result.ok) {
        setMatchesState((prev) =>
          prev.filter(
            (match) =>
              !(
                match.id === result.matchId &&
                match.stage === result.stage
              )
          )
        );
      }
    });
  };

  const submitLogin = () => {
    const username = usernameInput.trim();
    const password = passwordInput;

    if (!username) {
      setAuthError("Username is required.");
      return;
    }
    if (!password) {
      setAuthError("Password is required.");
      return;
    }

    startAuthTransition(async () => {
      const result = await loginReferee({ username, password });
      if (!result || "error" in result) {
        setAuthError(result?.error ?? "Unable to sign in.");
        return;
      }

      setAuthError(null);
      setPasswordInput("");
      setSessionAuthenticated(true);
      router.refresh();
    });
  };

  const submitLogout = () => {
    startAuthTransition(async () => {
      await logoutReferee();
      setSessionAuthenticated(false);
      setSubmitMessage(null);
      setSelectedMatchId("");
      setAuthError(null);
      router.refresh();
    });
  };

  return (
    <>
      <AlertDialog open={!sessionAuthenticated} onOpenChange={() => undefined}>
        <AlertDialogContent onEscapeKeyDown={(event) => event.preventDefault()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Referee Login</AlertDialogTitle>
            <AlertDialogDescription>
              Sign in with your referee account to submit match scores.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="mt-4 space-y-3">
            <div>
              <label htmlFor="referee-username" className="text-xs font-medium text-muted-foreground">
                Username
              </label>
              <input
                id="referee-username"
                value={usernameInput}
                onChange={(event) => {
                  setUsernameInput(event.target.value);
                  setAuthError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    submitLogin();
                  }
                }}
                autoComplete="username"
                className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div>
              <label htmlFor="referee-password" className="text-xs font-medium text-muted-foreground">
                Password
              </label>
              <input
                id="referee-password"
                type="password"
                value={passwordInput}
                onChange={(event) => {
                  setPasswordInput(event.target.value);
                  setAuthError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    submitLogin();
                  }
                }}
                autoComplete="current-password"
                className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            {authError ? <p className="text-sm text-red-600">{authError}</p> : null}
            <Button type="button" onClick={submitLogin} className="w-full" disabled={authPending}>
              {authPending ? "Signing in..." : "Sign in"}
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>

      <div className="space-y-6">
        <div className="flex items-center justify-between rounded-xl border border-border bg-card/70 px-4 py-3 text-sm">
          <p className="text-muted-foreground">
            Signed in as <span className="font-medium text-foreground">{refereeDisplayName ?? "Referee"}</span>
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={submitLogout}
            disabled={!sessionAuthenticated || authPending}
          >
            Logout
          </Button>
        </div>

        <MatchContextBar
          stage={stage}
          onStageChange={handleStageChange}
          selectedCourt={selectedCourt}
          onCourtChange={handleCourtChange}
          matches={matchOptions}
          selectedMatchId={activeSelectedMatchId}
          onMatchChange={handleMatchChange}
          disabled={!sessionAuthenticated || authPending}
        />

        <div className="rounded-2xl border border-border bg-card p-4 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={toggleDisplaySides}
                disabled={!selectedMatch || controlsDisabled}
                data-testid="swap-sides-button"
              >
                {isSidesSwapped ? "Reset Sides" : "Swap Sides"}
              </Button>
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {isSidesSwapped ? "Display: Swapped" : "Display: Normal"}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-4 sm:p-6">
          {isFinal || bestOf3Enabled ? (
            <div className="mb-3 flex justify-end sm:mb-4">
              <BestOf3Controls
                enabled={bestOf3Enabled}
                onToggle={toggleBestOf3}
                toggleDisabled={requiresBestOf3}
                game={activeGame}
                onGameChange={changeGame}
              />
            </div>
          ) : null}

          <div className="mx-auto grid w-full max-w-[20rem] grid-cols-[1fr_auto_1fr] grid-rows-[auto_auto_auto_auto_auto] items-center gap-x-3 gap-y-3 sm:max-w-[24rem] sm:gap-x-6">
            <div
              className="col-start-1 row-start-1 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
              data-testid="court-left-label"
            >
              Court Left
            </div>
            <div
              className="col-start-3 row-start-1 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
              data-testid="court-right-label"
            >
              Court Right
            </div>
            <Button
              type="button"
              variant="outline"
              className="col-start-1 row-start-2 h-10 w-10 justify-self-center text-xl sm:h-12 sm:w-12"
              onClick={() => adjustScore(leftScoreSide, 1)}
              disabled={controlsDisabled}
            >
              +
            </Button>
            <Button
              type="button"
              variant="outline"
              className="col-start-3 row-start-2 h-10 w-10 justify-self-center text-xl sm:h-12 sm:w-12"
              onClick={() => adjustScore(rightScoreSide, 1)}
              disabled={controlsDisabled}
            >
              +
            </Button>

            <div className="col-start-1 row-start-3 flex items-center justify-center" data-testid="score-left-column">
              <div className="relative flex h-20 w-20 items-center justify-center rounded-xl border-2 border-foreground bg-black text-3xl font-semibold text-white shadow-inner sm:h-24 sm:w-24 sm:text-4xl">
                <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-white/25" />
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={displayMatch ? String(leftScore) : ""}
                  onChange={(event) => setScore(leftScoreSide, event.target.value)}
                  disabled={controlsDisabled}
                  className="h-full w-full bg-transparent text-center text-3xl font-semibold text-white outline-none sm:text-4xl"
                  aria-label="Home score"
                />
              </div>
            </div>

            <div className="col-start-2 row-start-3 flex items-center justify-center text-2xl font-semibold text-foreground sm:text-3xl">
              -
            </div>

            <div className="col-start-3 row-start-3 flex items-center justify-center" data-testid="score-right-column">
              <div className="relative flex h-20 w-20 items-center justify-center rounded-xl border-2 border-foreground bg-black text-3xl font-semibold text-white shadow-inner sm:h-24 sm:w-24 sm:text-4xl">
                <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-white/25" />
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={displayMatch ? String(rightScore) : ""}
                  onChange={(event) => setScore(rightScoreSide, event.target.value)}
                  disabled={controlsDisabled}
                  className="h-full w-full bg-transparent text-center text-3xl font-semibold text-white outline-none sm:text-4xl"
                  aria-label="Away score"
                />
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              className="col-start-1 row-start-4 h-10 w-10 justify-self-center text-xl sm:h-12 sm:w-12"
              onClick={() => adjustScore(leftScoreSide, -1)}
              disabled={controlsDisabled}
            >
              -
            </Button>
            <Button
              type="button"
              variant="outline"
              className="col-start-3 row-start-4 h-10 w-10 justify-self-center text-xl sm:h-12 sm:w-12"
              onClick={() => adjustScore(rightScoreSide, -1)}
              disabled={controlsDisabled}
            >
              -
            </Button>

            <div
              className="col-start-1 row-start-5 px-1 text-center text-sm text-muted-foreground break-words"
              data-testid="left-team-name"
            >
              {displayMatch ? teamLabel(leftTeam) : "Home team"}
            </div>
            <div
              className="col-start-3 row-start-5 px-1 text-center text-sm text-muted-foreground break-words"
              data-testid="right-team-name"
            >
              {displayMatch ? teamLabel(rightTeam) : "Away team"}
            </div>
          </div>

          {!displayMatch ? (
            <p className="mt-6 text-center text-sm text-muted-foreground">Select a match to start scoring.</p>
          ) : null}

          {submitMessage ? (
            <p className="mt-4 text-center text-sm text-muted-foreground">{submitMessage}</p>
          ) : null}
        </div>

        <BottomBar
          locked={locked}
          onToggleLock={toggleLock}
          onSubmit={submitScore}
          submitDisabled={!sessionAuthenticated || !selectedMatch || !locked || submitPending || authPending}
          isSubmitting={submitPending}
          disabled={!sessionAuthenticated || !selectedMatch || submitPending || authPending}
          hidden={actionsHidden}
        />
      </div>
    </>
  );
}
