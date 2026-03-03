"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { REFEREE_GUIDELINE_SINGLETON_ID } from "@/app/referee-guideline/constants";

const MAX_SECTIONS_PER_TAB = 30;
const MAX_TEXT_LENGTH = 5000;
const MAX_URL_LENGTH = 2048;
const REFEREE_GUIDELINE_PATH = "/referee-guideline";
type StoredRefereeGuidelineSection = {
  text: string;
  imageUrl: string | null;
};

type RefereeGuidelineSectionInput = {
  text?: unknown;
  imageUrl?: unknown;
};

type SaveRefereeGuidelineInput = {
  mainRefereeSections?: RefereeGuidelineSectionInput[];
  lineRefereeSections?: RefereeGuidelineSectionInput[];
};

function sanitizeSections(
  input: unknown,
  tabLabel: "Main referee" | "Line referee"
): { sections: StoredRefereeGuidelineSection[] } | { error: string } {
  if (!Array.isArray(input)) {
    return { error: `${tabLabel} sections must be an array.` };
  }

  if (input.length > MAX_SECTIONS_PER_TAB) {
    return {
      error: `${tabLabel} supports up to ${MAX_SECTIONS_PER_TAB} sections.`,
    };
  }

  const sections: StoredRefereeGuidelineSection[] = [];

  for (let index = 0; index < input.length; index += 1) {
    const item = input[index];
    const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};

    const text = typeof row.text === "string" ? row.text.trim() : "";
    if (text.length > MAX_TEXT_LENGTH) {
      return {
        error: `${tabLabel} section ${index + 1}: text must be ${MAX_TEXT_LENGTH} characters or fewer.`,
      };
    }

    const rawImageUrl = typeof row.imageUrl === "string" ? row.imageUrl.trim() : "";
    if (rawImageUrl.length > MAX_URL_LENGTH) {
      return {
        error: `${tabLabel} section ${index + 1}: image URL must be ${MAX_URL_LENGTH} characters or fewer.`,
      };
    }

    let imageUrl: string | null = null;
    if (rawImageUrl) {
      let parsed: URL;
      try {
        parsed = new URL(rawImageUrl);
      } catch {
        return {
          error: `${tabLabel} section ${index + 1}: image URL is invalid.`,
        };
      }

      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return {
          error: `${tabLabel} section ${index + 1}: image URL must start with http:// or https://.`,
        };
      }

      imageUrl = parsed.toString();
    }

    if (text || imageUrl) {
      sections.push({ text, imageUrl });
    }
  }

  return { sections };
}

export async function saveRefereeGuideline(input: SaveRefereeGuidelineInput) {
  const guard = await requireAdmin({ onFail: "return" });
  if (guard) return guard;

  const mainResult = sanitizeSections(input.mainRefereeSections ?? [], "Main referee");
  if ("error" in mainResult) {
    return mainResult;
  }

  const lineResult = sanitizeSections(input.lineRefereeSections ?? [], "Line referee");
  if ("error" in lineResult) {
    return lineResult;
  }

  await prisma.refereeGuideline.upsert({
    where: {
      id: REFEREE_GUIDELINE_SINGLETON_ID,
    },
    update: {
      mainRefereeSections: mainResult.sections,
      lineRefereeSections: lineResult.sections,
    },
    create: {
      id: REFEREE_GUIDELINE_SINGLETON_ID,
      mainRefereeSections: mainResult.sections,
      lineRefereeSections: lineResult.sections,
    },
  });

  revalidatePath(REFEREE_GUIDELINE_PATH);
  return { ok: true as const };
}
