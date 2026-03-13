import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { getRoleFromRequest } from "@/lib/auth";
import { loadTieBreakState } from "@/app/tie-breaks/actions";
import { TieBreaksClient } from "@/app/tie-breaks/tie-breaks-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tie Breaks" };

type TieBreaksPageProps = {
  searchParams?: Promise<{ category?: string }>;
};

const categories = ["MD", "WD", "XD"] as const;

function parseCategory(value: string | undefined): (typeof categories)[number] {
  if (value === "WD" || value === "XD") return value;
  return "MD";
}

export default async function TieBreaksPage({ searchParams }: TieBreaksPageProps) {
  const role = await getRoleFromRequest();
  if (role !== "admin") {
    redirect("/presenting");
  }

  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const selectedCategory = parseCategory(resolvedSearchParams?.category);
  const initialState = await loadTieBreakState(selectedCategory);

  return (
    <section className="rounded-2xl border border-border bg-card p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Tie Breaks</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Admin-only manual ordering for fallback ranking ties.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {categories.map((categoryCode) => (
            <Button
              key={categoryCode}
              asChild
              variant={categoryCode === selectedCategory ? "default" : "outline"}
              size="sm"
            >
              <Link href={`/tie-breaks?category=${categoryCode}`}>{categoryCode}</Link>
            </Button>
          ))}
        </div>
      </div>

      <div className="mt-6">
        <TieBreaksClient key={selectedCategory} initialState={initialState} />
      </div>
    </section>
  );
}
