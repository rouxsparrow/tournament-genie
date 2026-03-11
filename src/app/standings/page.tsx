import { StandingsClient } from "@/app/standings/standings-client";
import { getRoleFromRequest } from "@/lib/auth";
import { getFavouritePlayerCategoryMap, getFavouritePlayerContext } from "@/lib/favourite-player";
import { getCachedStandingsSummary } from "@/lib/public-read-models/loaders";
import type { CategoryCode } from "@/lib/public-read-models/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Standings" };

type StandingsPageProps = {
  searchParams?: Promise<{ category?: string; error?: string; fromNav?: string; groupId?: string }>;
};

const categories: CategoryCode[] = ["MD", "WD", "XD"];

function parseCategory(value: string | undefined): CategoryCode {
  if (value === "WD" || value === "XD") return value;
  return "MD";
}

export default async function StandingsPage({ searchParams }: StandingsPageProps) {
  const role = await getRoleFromRequest();
  const favourite = await getFavouritePlayerContext();
  const favouriteMap = await getFavouritePlayerCategoryMap();
  const isViewer = role === "viewer";

  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const fromNav = resolvedSearchParams?.fromNav === "1";
  const requestedGroupId = resolvedSearchParams?.groupId ?? "";

  const selectedCategory =
    isViewer && fromNav && favourite?.categoryCode
      ? parseCategory(favourite.categoryCode)
      : parseCategory(resolvedSearchParams?.category);

  const favouriteGroupForCategory = favouriteMap.get(selectedCategory)?.groupId ?? "";
  const initialGroupId = fromNav && isViewer ? favouriteGroupForCategory : requestedGroupId;
  const errorMessage = resolvedSearchParams?.error
    ? decodeURIComponent(resolvedSearchParams.error)
    : null;

  const favouriteGroupByCategory: Record<CategoryCode, string> = {
    MD: favouriteMap.get("MD")?.groupId ?? "",
    WD: favouriteMap.get("WD")?.groupId ?? "",
    XD: favouriteMap.get("XD")?.groupId ?? "",
  };

  const initialData = await getCachedStandingsSummary(selectedCategory);

  return (
    <section className="rounded-2xl border border-border bg-card p-8">
      <StandingsClient
        categories={categories}
        initialCategoryCode={selectedCategory}
        initialData={initialData}
        favouritePlayerName={favourite?.playerName ?? null}
        initialGroupId={initialGroupId}
        favouriteGroupByCategory={favouriteGroupByCategory}
        isViewer={isViewer}
        errorMessage={errorMessage}
      />
    </section>
  );
}
