import Link from "next/link";
import { redirect } from "next/navigation";
import {
  CalendarRange,
  FolderKanban,
  Radio,
  ShieldCheck,
  Trophy,
  Users,
  Wrench,
} from "lucide-react";
import { getRoleFromRequest } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin" };

const ADMIN_LINKS = [
  { href: "/players", label: "Players", icon: Users },
  { href: "/teams", label: "Teams", icon: ShieldCheck },
  { href: "/groups", label: "Groups", icon: FolderKanban },
  { href: "/knockout", label: "Knockout", icon: Trophy },
  { href: "/broadcast", label: "Broadcast", icon: Radio },
  { href: "/utilities", label: "Utilities", icon: Wrench },
  { href: "/schedule-overview", label: "Schedule Overview", icon: CalendarRange },
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
            className="group rounded-xl border border-border bg-muted/30 p-4 text-foreground transition hover:bg-muted/70"
          >
            <div className="flex items-center gap-3">
              <item.icon className="h-5 w-5 text-muted-foreground transition group-hover:text-foreground" />
              <span className="text-sm font-medium leading-tight">{item.label}</span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
