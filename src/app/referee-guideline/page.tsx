import { Prisma } from "@prisma/client";
import { getRoleFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { REFEREE_GUIDELINE_SINGLETON_ID } from "@/app/referee-guideline/constants";
import {
  RefereeGuidelineClient,
  type RefereeGuidelineSection,
} from "@/app/referee-guideline/referee-guideline-client";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Referee Guideline",
  robots: { index: false, follow: false },
};

const DEFAULT_LINE_REFEREE_SECTIONS: RefereeGuidelineSection[] = [
  {
    text: `# 🏸 Line Referee (Line Judge) - Brief Guide

This guide outlines the responsibilities and expected conduct of all Line Referees during the tournament.

## 1️⃣ Role & Responsibility
- Judging whether the shuttle lands IN or OUT on the assigned boundary line
- Making clear, immediate, and confident calls
- Supporting the Main Referee to ensure fair play
You are responsible only for your assigned line.

## 2️⃣ Positioning
- Sit aligned with the assigned boundary line.
- Keep a clear and unobstructed view of the shuttle landing area.
- Stay focused throughout each rally.
- Do not look at players or crowd reactions before making your call.

## 3️⃣ Call Signals
### ✅ IN
- Point your right hand down toward the line.
- Say clearly: "IN"

### ❌ OUT
- Extend both arms horizontally to the side.
- Say clearly: "OUT"

### 👁 Unsighted
- Cover your eyes briefly with both hands.
- Do not make a verbal call.
(The Main Referee will decide if you are unsighted.)

## 4️⃣ Timing of Calls
- Make your call immediately after the shuttle lands.
- Be decisive and confident.
- Do not delay your call.
- Do not change your decision after making it.

## 5️⃣ Professional Conduct
- Remain neutral at all times.
- Do not argue with players.
- Do not explain your decision unless asked by the Main Referee.
- Ignore crowd reactions.
- Maintain calm and professional body language.

## 6️⃣ Communication Protocol
If the Main Referee asks for confirmation, respond briefly:
- "IN"
- "OUT"
- "Unsighted"
The final decision rests with the Main Referee.

## 🎯 Key Reminder
> Watch the line. Make the call. Stay neutral.`,
    imageUrl: null,
  },
];

function parseSections(input: Prisma.JsonValue | null | undefined): RefereeGuidelineSection[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const sections: RefereeGuidelineSection[] = [];
  for (const item of input) {
    const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const text = typeof row.text === "string" ? row.text.trim() : "";
    const rawImageUrl = typeof row.imageUrl === "string" ? row.imageUrl.trim() : "";
    const imageUrl = rawImageUrl || null;

    if (text || imageUrl) {
      sections.push({ text, imageUrl });
    }
  }

  return sections;
}

export default async function RefereeGuidelinePage() {
  const [role, guideline] = await Promise.all([
    getRoleFromRequest(),
    prisma.refereeGuideline.findUnique({
      where: { id: REFEREE_GUIDELINE_SINGLETON_ID },
      select: {
        mainRefereeSections: true,
        lineRefereeSections: true,
      },
    }),
  ]);

  const mainRefereeSections = parseSections(guideline?.mainRefereeSections);
  const lineRefereeSections = parseSections(guideline?.lineRefereeSections);
  const effectiveLineRefereeSections =
    lineRefereeSections.length > 0 ? lineRefereeSections : DEFAULT_LINE_REFEREE_SECTIONS;

  return (
    <section className="rounded-2xl border border-border bg-card p-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Referee Guideline</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Operational guidance for main referees and line referees.
        </p>
      </div>

      <RefereeGuidelineClient
        isAdmin={role === "admin"}
        initialMainRefereeSections={mainRefereeSections}
        initialLineRefereeSections={effectiveLineRefereeSections}
      />
    </section>
  );
}
