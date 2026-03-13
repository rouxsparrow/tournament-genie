import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { updateTeam } from "@/app/teams/actions";
import { Button } from "@/components/ui/button";
import { PlayerSelect } from "@/app/teams/player-select";
import { GlobalFormPendingBridge } from "@/components/global-form-pending-bridge";
import {
  hasGeneratedMatches,
  hasPlayedMatches,
  type TeamEditMatchState,
} from "@/app/teams/substitution-policy";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit Team" };

type TeamsEditPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ error?: string }>;
};

export default async function TeamsEditPage({
  params,
  searchParams,
}: TeamsEditPageProps) {
  const { id } = await params;
  const team = await prisma.team.findUnique({
    where: { id },
    include: {
      category: true,
      members: true,
      flags: true,
    },
  });

  if (!team) {
    notFound();
  }

  const [players, generatedGroupCount, playedGroupCount, generatedKnockoutCount, playedKnockoutCount] =
    await Promise.all([
      prisma.player.findMany({
        orderBy: { name: "asc" },
      }),
      prisma.match.count({
        where: {
          stage: "GROUP",
          OR: [{ homeTeamId: team.id }, { awayTeamId: team.id }],
        },
      }),
      prisma.match.count({
        where: {
          stage: "GROUP",
          status: "COMPLETED",
          OR: [{ homeTeamId: team.id }, { awayTeamId: team.id }],
        },
      }),
      prisma.knockoutMatch.count({
        where: {
          OR: [{ homeTeamId: team.id }, { awayTeamId: team.id }],
        },
      }),
      prisma.knockoutMatch.count({
        where: {
          status: "COMPLETED",
          OR: [{ homeTeamId: team.id }, { awayTeamId: team.id }],
        },
      }),
    ]);

  const matchState: TeamEditMatchState = {
    generatedGroupCount,
    generatedKnockoutCount,
    playedGroupCount,
    playedKnockoutCount,
  };
  const generatedMatchExists = hasGeneratedMatches(matchState);
  const playedMatchExists = hasPlayedMatches(matchState);

  const [member1, member2] = team.members;

  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const errorMessage = resolvedSearchParams?.error
    ? decodeURIComponent(resolvedSearchParams.error)
    : null;

  return (
    <section className="rounded-2xl border border-border bg-card p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-foreground">Edit team</h1>
        <Button asChild variant="outline">
          <Link href="/teams">Back</Link>
        </Button>
      </div>
      <form
        action={updateTeam.bind(null, team.id)}
        className="mt-6 space-y-4"
      >
        <GlobalFormPendingBridge />
        {errorMessage ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {errorMessage}
          </div>
        ) : null}
        {playedMatchExists ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            This team already has completed matches. Team members cannot be changed.
          </div>
        ) : generatedMatchExists ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Matches are already generated for this team. Category is locked and exactly one player
            must be replaced.
          </div>
        ) : null}
        <div>
          <span className="text-sm font-medium text-muted-foreground">Category</span>
          <div className="mt-2 flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="radio"
                name="category"
                value="MD"
                className="h-4 w-4"
                defaultChecked={team.category.code === "MD"}
                disabled={generatedMatchExists}
                required
              />
              Men&apos;s Doubles (MD)
            </label>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="radio"
                name="category"
                value="WD"
                className="h-4 w-4"
                defaultChecked={team.category.code === "WD"}
                disabled={generatedMatchExists}
                required
              />
              Women&apos;s Doubles (WD)
            </label>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="radio"
                name="category"
                value="XD"
                className="h-4 w-4"
                defaultChecked={team.category.code === "XD"}
                disabled={generatedMatchExists}
                required
              />
              Mixed Doubles (XD)
            </label>
          </div>
          {generatedMatchExists ? (
            <input type="hidden" name="category" value={team.category.code} />
          ) : null}
        </div>
        <PlayerSelect
          id="player1"
          name="player1Id"
          label="Player 1"
          players={players}
          defaultPlayerId={member1?.playerId}
          disabled={playedMatchExists}
        />
        <PlayerSelect
          id="player2"
          name="player2Id"
          label="Player 2"
          players={players}
          defaultPlayerId={member2?.playerId}
          disabled={playedMatchExists}
        />
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            name="isGroupSeed"
            className="h-4 w-4 rounded border-input"
            defaultChecked={team.flags?.isGroupSeed ?? false}
            disabled={playedMatchExists}
          />
          Mark as group seed
        </label>
        <div className="flex justify-end">
          <Button type="submit" disabled={playedMatchExists}>
            Save changes
          </Button>
        </div>
      </form>
    </section>
  );
}
