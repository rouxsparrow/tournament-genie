import Link from "next/link";
import { createPlayer } from "@/app/players/actions";
import { Button } from "@/components/ui/button";

type PlayersNewPageProps = {
  searchParams?: Promise<{ error?: string; success?: string }>;
};

export default async function PlayersNewPage({
  searchParams,
}: PlayersNewPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const errorMessage = resolvedSearchParams?.error
    ? decodeURIComponent(resolvedSearchParams.error)
    : null;
  const successMessage = resolvedSearchParams?.success
    ? decodeURIComponent(resolvedSearchParams.success)
    : null;

  return (
    <section className="rounded-2xl border border-border bg-card p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-foreground">Add player</h1>
        <Button asChild variant="outline">
          <Link href="/players">Back</Link>
        </Button>
      </div>
      <form action={createPlayer} className="mt-6 space-y-4">
        {errorMessage ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {errorMessage}
          </div>
        ) : null}
        {successMessage ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {successMessage}
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
            placeholder="Player name"
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
                required
              />
              Female
            </label>
          </div>
        </div>
        <div className="flex justify-end">
          <Button type="submit">Create player</Button>
        </div>
      </form>
    </section>
  );
}

