import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="grid gap-6">
      <div className="rounded-2xl border border-border bg-card p-8 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Tournament Genie
        </p>
        <h1 className="mt-3 text-3xl font-semibold text-foreground">
          Manual-first tournament control for doubles events.
        </h1>
        <p className="mt-4 max-w-2xl text-base text-muted-foreground">
          Manage players, teams, groups, and brackets with clear rules and
          stable workflows designed for live tournament operation.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild>
            <Link href="/players">Manage players</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/teams">Create teams</Link>
          </Button>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {[
          {
            title: "Group stage",
            description: "Round-robin groups with manual or seeded random draw.",
          },
          {
            title: "Series split",
            description: "Automatic split into Series A and Series B after lock.",
          },
          {
            title: "Knockout brackets",
            description: "Single-elimination brackets with optional second chance.",
          },
        ].map((card) => (
          <div
            key={card.title}
            className="rounded-xl border border-border bg-card p-5"
          >
            <h2 className="text-base font-semibold text-foreground">
              {card.title}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">{card.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

