import Link from "next/link";
import { redirect } from "next/navigation";
import { getRoleFromRequest } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin" };

const ADMIN_LINKS = [
  { href: "/players", label: "Players" },
  { href: "/teams", label: "Teams" },
  { href: "/groups", label: "Groups" },
  { href: "/matches", label: "Matches" },
  { href: "/knockout", label: "Knockout" },
  { href: "/schedule", label: "Schedule" },
  { href: "/schedule-overview", label: "Schedule Overview" },
  { href: "/presenting", label: "Live Matches" },
];

export default async function AdminPage() {
  const role = await getRoleFromRequest();
  if (role !== "admin") {
    redirect("/presenting");
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Admin</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Admin-only shortcuts to tournament setup and operations.
        </p>
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-2">
        {ADMIN_LINKS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm font-medium text-foreground hover:bg-muted"
          >
            {item.label}
          </Link>
        ))}
      </div>
    </section>
  );
}
