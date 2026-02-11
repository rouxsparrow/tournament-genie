import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { updatePlayer } from "@/app/players/actions";
import { Button } from "@/components/ui/button";
import { GlobalFormPendingBridge } from "@/components/global-form-pending-bridge";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit Player" };

type PlayersEditPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: { error?: string };
};

export default async function PlayersEditPage({
  params,
  searchParams,
}: PlayersEditPageProps) {
  const { id } = await params;
  const player = await prisma.player.findUnique({
    where: { id },
  });

  if (!player) {
    notFound();
  }

  const errorMessage = searchParams?.error
    ? decodeURIComponent(searchParams.error)
    : null;

  return (
    <section className="rounded-2xl border border-border bg-card p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-foreground">Edit player</h1>
        <Button asChild variant="outline">
          <Link href="/players">Back</Link>
        </Button>
      </div>
      <form
        action={updatePlayer.bind(null, player.id)}
        className="mt-6 space-y-4"
      >
        <GlobalFormPendingBridge />
        {errorMessage ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {errorMessage}
          </div>
        ) : null}
        <div>
          <label className="text-sm font-medium text-muted-foreground" htmlFor="name">
            Name
          </label>
          <input
            id="name"
            name="name"
            className="mt-2 w-full rounded-md border border-input px-3 py-2 text-sm focus:border-ring focus:outline-none"
            defaultValue={player.name}
            required
          />
        </div>
        <div>
          <span className="text-sm font-medium text-muted-foreground">Gender</span>
          <div className="mt-2 flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="radio"
                name="gender"
                value="MALE"
                className="h-4 w-4"
                defaultChecked={player.gender === "MALE"}
                required
              />
              Male
            </label>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="radio"
                name="gender"
                value="FEMALE"
                className="h-4 w-4"
                defaultChecked={player.gender === "FEMALE"}
                required
              />
              Female
            </label>
          </div>
        </div>
        <div className="flex justify-end">
          <Button type="submit">Save changes</Button>
        </div>
      </form>
    </section>
  );
}
