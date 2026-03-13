export type CategoryCode = "MD" | "WD" | "XD";
export type SeriesCode = "A" | "B";
export type PublicScheduleStage = "GROUP" | "KNOCKOUT";

export type PublicTeamMember = {
  player: { name: string };
};

export type PublicTeam = {
  id: string;
  name: string;
  members: PublicTeamMember[];
};

export type PublicStandingRow = {
  teamId: string;
  teamName: string;
  wins: number;
  losses: number;
  played: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDiff: number;
  avgPointDiff: number;
  avgPointsFor: number;
};

export type PublicGroupSummary = {
  group: {
    id: string;
    name: string;
    teamCount: number;
  };
  standings: PublicStandingRow[];
  completedCount: number;
};

export type PublicStandingsSummary = {
  categoryCode: CategoryCode;
  groups: PublicGroupSummary[];
};

export type PublicMatchGame = {
  gameNumber: number;
  homePoints: number;
  awayPoints: number;
};

export type PublicCompletedMatch = {
  id: string;
  status: "COMPLETED";
  winnerTeamId: string | null;
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeTeamName: string;
  awayTeamName: string;
  games: PublicMatchGame[];
};

export type PublicStandingsGroupMatches = {
  groupId: string;
  matches: PublicCompletedMatch[];
};

export type PublicBracketMatch = {
  id: string;
  round: number;
  matchNo: number;
  status: "SCHEDULED" | "COMPLETED";
  winnerTeamId: string | null;
  games: PublicMatchGame[];
  previousMatches: { round: number; matchNo: number; nextSlot: number | null }[];
  homeTeam: {
    id: string | null;
    name: string;
    seed: number | null;
  };
  awayTeam: {
    id: string | null;
    name: string;
    seed: number | null;
  };
};

export type PublicBracketsState = {
  categoryCode: CategoryCode;
  series: SeriesCode;
  isWD: boolean;
  showPlayIns: boolean;
  matches: PublicBracketMatch[];
};
