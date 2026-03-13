import type { RankingTieCategoryCode, RankingTieOrderSource, RankingTieScope } from "@/lib/ranking-tie-override";

export type TieBreakTeam = {
  teamId: string;
  teamName: string;
  groupName?: string;
};

export type GroupStandingTieCard = {
  scope: "GROUP_STANDINGS";
  categoryCode: RankingTieCategoryCode;
  tieKey: string;
  groupId: string;
  groupName: string;
  wins: number;
  avgPD: number;
  avgPF: number;
  source: RankingTieOrderSource;
  orderedTeamIds: string[];
  teams: TieBreakTeam[];
};

export type GlobalRankingTieCard = {
  scope: "GLOBAL_GROUP_RANKING";
  categoryCode: RankingTieCategoryCode;
  tieKey: string;
  groupRank: number;
  avgPD: number;
  source: RankingTieOrderSource;
  orderedTeamIds: string[];
  teams: TieBreakTeam[];
};

export type TieBreakState = {
  categoryCode: RankingTieCategoryCode;
  isBlocked: boolean;
  blockedReason: string | null;
  groupStandingTies: GroupStandingTieCard[];
  globalRankingTies: GlobalRankingTieCard[];
};

export type TieBreakActionPayload = {
  categoryCode: RankingTieCategoryCode;
  scope: RankingTieScope;
  tieKey: string;
};

export type SaveTieBreakOverrideInput = TieBreakActionPayload & {
  orderedTeamIds: string[];
};

export type TieBreakActionResult =
  | {
      ok: true;
      message: string;
      state: TieBreakState;
    }
  | {
      error: string;
      state?: TieBreakState;
    };
