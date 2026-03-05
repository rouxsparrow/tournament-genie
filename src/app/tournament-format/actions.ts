"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { TOURNAMENT_FORMAT_SINGLETON_ID } from "@/app/tournament-format/constants";

const MAX_SECTIONS = 30;
const MAX_TEXT_LENGTH = 5000;
const MAX_URL_LENGTH = 2048;
const TOURNAMENT_FORMAT_PATH = "/tournament-format";

type StoredTournamentFormatSection = {
  text: string;
  imageUrl: string | null;
};

type TournamentFormatSectionInput = {
  text?: unknown;
  imageUrl?: unknown;
};

type SaveTournamentFormatInput = {
  sections?: TournamentFormatSectionInput[];
};

function sanitizeSections(
  input: unknown
): { sections: StoredTournamentFormatSection[] } | { error: string } {
  if (!Array.isArray(input)) {
    return { error: "Tournament format sections must be an array." };
  }

  if (input.length > MAX_SECTIONS) {
    return {
      error: `Tournament format supports up to ${MAX_SECTIONS} sections.`,
    };
  }

  const sections: StoredTournamentFormatSection[] = [];

  for (let index = 0; index < input.length; index += 1) {
    const item = input[index];
    const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};

    const text = typeof row.text === "string" ? row.text.trim() : "";
    if (text.length > MAX_TEXT_LENGTH) {
      return {
        error: `Section ${index + 1}: text must be ${MAX_TEXT_LENGTH} characters or fewer.`,
      };
    }

    const rawImageUrl = typeof row.imageUrl === "string" ? row.imageUrl.trim() : "";
    if (rawImageUrl.length > MAX_URL_LENGTH) {
      return {
        error: `Section ${index + 1}: image URL must be ${MAX_URL_LENGTH} characters or fewer.`,
      };
    }

    let imageUrl: string | null = null;
    if (rawImageUrl) {
      if (rawImageUrl.startsWith("//")) {
        return {
          error: `Section ${index + 1}: image URL is invalid.`,
        };
      }

      const normalizedImageUrl =
        rawImageUrl.startsWith("/") || /^https?:\/\//i.test(rawImageUrl)
          ? rawImageUrl
          : `/${rawImageUrl}`;

      if (normalizedImageUrl.startsWith("/")) {
        imageUrl = normalizedImageUrl;
      } else {
        let parsed: URL;
        try {
          parsed = new URL(normalizedImageUrl);
        } catch {
          return {
            error: `Section ${index + 1}: image URL is invalid.`,
          };
        }

        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          return {
            error: `Section ${index + 1}: image URL must start with /, http://, or https://.`,
          };
        }

        imageUrl = parsed.toString();
      }
    }

    if (text || imageUrl) {
      sections.push({ text, imageUrl });
    }
  }

  return { sections };
}

export async function saveTournamentFormat(input: SaveTournamentFormatInput) {
  const guard = await requireAdmin({ onFail: "return" });
  if (guard) return guard;

  const result = sanitizeSections(input.sections ?? []);
  if ("error" in result) {
    return result;
  }

  await prisma.tournamentFormat.upsert({
    where: {
      id: TOURNAMENT_FORMAT_SINGLETON_ID,
    },
    update: {
      sections: result.sections,
    },
    create: {
      id: TOURNAMENT_FORMAT_SINGLETON_ID,
      sections: result.sections,
    },
  });

  revalidatePath(TOURNAMENT_FORMAT_PATH);
  return { ok: true as const };
}
