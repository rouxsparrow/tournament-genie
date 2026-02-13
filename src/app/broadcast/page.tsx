import Link from "next/link";
import { redirect } from "next/navigation";
import { getPresentingState } from "@/app/schedule/actions";
import { BroadcastClient } from "@/app/broadcast/broadcast-client";
import { Button } from "@/components/ui/button";
import { getRoleFromRequest } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Broadcast" };

export default async function BroadcastPage({
  searchParams,
}: {
  searchParams?: Promise<{ stage?: string | string[] }>;
}) {
  const role = await getRoleFromRequest();
  if (role !== "admin") {
    redirect("/presenting");
  }

  const resolvedParams = (await searchParams) ?? {};
  const stageParam =
    typeof resolvedParams.stage === "string" ? resolvedParams.stage.toLowerCase() : "";
  const stage = stageParam === "ko" ? "KNOCKOUT" : "GROUP";
  const state = await getPresentingState({ category: "ALL", stage });
  const groupHref = "/broadcast?stage=group";
  const koHref = "/broadcast?stage=ko";

  return (
    <section className="rounded-2xl border border-border bg-card p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Broadcast</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            asChild
            size="sm"
            variant={stage === "GROUP" ? "default" : "outline"}
          >
            <Link href={groupHref}>Group Stage</Link>
          </Button>
          <Button
            asChild
            size="sm"
            variant={stage === "KNOCKOUT" ? "default" : "outline"}
          >
            <Link href={koHref}>Knockout</Link>
          </Button>
        </div>
      </div>

      <div className="mt-6">
        <BroadcastClient state={state} />
      </div>
    </section>
  );
}
