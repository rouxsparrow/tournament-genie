import { revalidateTag, updateTag } from "next/cache";
import type { CategoryCode, PublicScheduleStage, SeriesCode } from "@/lib/public-read-models/types";

export function standingsAllTag() {
  return "public:standings";
}

export function standingsCategoryTag(categoryCode: CategoryCode) {
  return `public:standings:${categoryCode}`;
}

export function standingsGroupMatchesTag(groupId: string) {
  return `public:standings:group:${groupId}`;
}

export function presentingAllTag() {
  return "public:presenting";
}

export function presentingStageTag(stage: PublicScheduleStage) {
  return `public:presenting:${stage}`;
}

export function bracketsAllTag() {
  return "public:brackets";
}

export function bracketsCategoryTag(categoryCode: CategoryCode) {
  return `public:brackets:${categoryCode}`;
}

export function bracketsSeriesTag(categoryCode: CategoryCode, series: SeriesCode) {
  return `public:brackets:${categoryCode}:${series}`;
}

export type PublicChangeEvent =
  | { type: "group-results"; categoryCodes?: CategoryCode[]; groupIds?: string[] }
  | { type: "knockout-results"; categoryCodes?: CategoryCode[]; series?: SeriesCode[] }
  | { type: "presenting"; stages?: PublicScheduleStage[] }
  | { type: "player-checkin" }
  | { type: "all" };

const ALL_CATEGORIES: CategoryCode[] = ["MD", "WD", "XD"];
const ALL_SERIES: SeriesCode[] = ["A", "B"];
const ALL_STAGES: PublicScheduleStage[] = ["GROUP", "KNOCKOUT"];
const REVALIDATE_PROFILE = "max";
const REMOTE_REVALIDATE_TIMEOUT_MS = 1_500;
const REMOTE_REVALIDATE_FORWARD_URL_ENV = "PUBLIC_REVALIDATE_FORWARD_URL";
const REMOTE_REVALIDATE_SECRET_ENV = "PUBLIC_REVALIDATE_SECRET";
export const PUBLIC_REVALIDATE_SECRET_HEADER = "x-tg-revalidate-secret";

function revalidateTagLater(tag: string) {
  revalidateTag(tag, REVALIDATE_PROFILE);
}

function expireTagNow(tag: string) {
  updateTag(tag);
}

function applyLocalPublicReadModelInvalidation(change: PublicChangeEvent) {
  if (change.type === "all") {
    revalidateTagLater(standingsAllTag());
    revalidateTagLater(presentingAllTag());
    revalidateTagLater(bracketsAllTag());
    ALL_CATEGORIES.forEach((categoryCode) => {
      revalidateTagLater(standingsCategoryTag(categoryCode));
      revalidateTagLater(bracketsCategoryTag(categoryCode));
      ALL_SERIES.forEach((series) => {
        revalidateTagLater(bracketsSeriesTag(categoryCode, series));
      });
    });
    ALL_STAGES.forEach((stage) => {
      revalidateTagLater(presentingStageTag(stage));
    });
    return;
  }

  if (change.type === "group-results") {
    expireTagNow(standingsAllTag());
    revalidateTagLater(presentingAllTag());
    revalidateTagLater(presentingStageTag("GROUP"));
    const categories = change.categoryCodes ?? ALL_CATEGORIES;
    categories.forEach((categoryCode) => {
      expireTagNow(standingsCategoryTag(categoryCode));
    });
    (change.groupIds ?? []).forEach((groupId) => {
      expireTagNow(standingsGroupMatchesTag(groupId));
    });
    return;
  }

  if (change.type === "knockout-results") {
    revalidateTagLater(bracketsAllTag());
    revalidateTagLater(presentingAllTag());
    revalidateTagLater(presentingStageTag("KNOCKOUT"));

    const categories = change.categoryCodes ?? ALL_CATEGORIES;
    const seriesList = change.series ?? ALL_SERIES;

    categories.forEach((categoryCode) => {
      revalidateTagLater(bracketsCategoryTag(categoryCode));
      seriesList.forEach((series) => {
        revalidateTagLater(bracketsSeriesTag(categoryCode, series));
      });
    });
    return;
  }

  if (change.type === "presenting") {
    revalidateTagLater(presentingAllTag());
    (change.stages ?? ALL_STAGES).forEach((stage) => {
      revalidateTagLater(presentingStageTag(stage));
    });
    return;
  }

  if (change.type === "player-checkin") {
    revalidateTagLater(presentingAllTag());
    ALL_STAGES.forEach((stage) => {
      revalidateTagLater(presentingStageTag(stage));
    });
  }
}

async function forwardPublicReadModelInvalidation(change: PublicChangeEvent) {
  const url = process.env[REMOTE_REVALIDATE_FORWARD_URL_ENV]?.trim();
  const secret = process.env[REMOTE_REVALIDATE_SECRET_ENV]?.trim();
  if (!url || !secret) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REMOTE_REVALIDATE_TIMEOUT_MS);
  const source = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown";

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [PUBLIC_REVALIDATE_SECRET_HEADER]: secret,
        "x-tg-revalidate-source": source,
      },
      body: JSON.stringify(change),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.warn("[public-read-models][forward] failed", {
        status: response.status,
        url,
        source,
        body: body.slice(0, 512),
      });
    }
  } catch (error) {
    console.warn("[public-read-models][forward] request error", {
      url,
      source,
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function invalidatePublicReadModels(
  change: PublicChangeEvent,
  options?: { skipRemoteForward?: boolean }
) {
  applyLocalPublicReadModelInvalidation(change);
  if (options?.skipRemoteForward) return;
  await forwardPublicReadModelInvalidation(change);
}
