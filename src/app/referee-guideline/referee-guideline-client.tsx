"use client";
/* eslint-disable @next/next/no-img-element -- Arbitrary external URLs are admin-provided and not constrained to configured Next image domains. */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { saveRefereeGuideline } from "@/app/referee-guideline/actions";

export type RefereeGuidelineSection = {
  text: string;
  imageUrl: string | null;
};

type TabKey = "main" | "line";

type RefereeGuidelineClientProps = {
  isAdmin: boolean;
  initialMainRefereeSections: RefereeGuidelineSection[];
  initialLineRefereeSections: RefereeGuidelineSection[];
};

type Notice = {
  type: "success" | "error";
  text: string;
};

type GuidelineBlock =
  | { type: "h1" | "h2" | "h3" | "paragraph" | "quote"; text: string }
  | { type: "list"; items: string[] };

function createEmptySection(): RefereeGuidelineSection {
  return {
    text: "",
    imageUrl: null,
  };
}

function displayTabLabel(tab: TabKey) {
  return tab === "main" ? "Main referee" : "Line referee";
}

function parseGuidelineBlocks(text: string): GuidelineBlock[] {
  const lines = text.split(/\r?\n/);
  const blocks: GuidelineBlock[] = [];
  let index = 0;

  const isImplicitHeading = (line: string) => {
    return (
      /^\d+\)\s+/.test(line) ||
      /^(IN|OUT|Unsighted|Key Reminder)$/i.test(line)
    );
  };

  while (index < lines.length) {
    const raw = lines[index] ?? "";
    const line = raw.trim();

    if (!line || line === "---") {
      index += 1;
      continue;
    }

    if (line.startsWith("# ")) {
      blocks.push({ type: "h1", text: line.slice(2).trim() });
      index += 1;
      continue;
    }

    if (line.startsWith("## ")) {
      blocks.push({ type: "h2", text: line.slice(3).trim() });
      index += 1;
      continue;
    }

    if (line.startsWith("### ")) {
      blocks.push({ type: "h3", text: line.slice(4).trim() });
      index += 1;
      continue;
    }

    if (line.startsWith("> ")) {
      const quoteLines: string[] = [];
      while (index < lines.length) {
        const nextLine = (lines[index] ?? "").trim();
        if (!nextLine.startsWith("> ")) break;
        quoteLines.push(nextLine.slice(2).trim());
        index += 1;
      }
      blocks.push({ type: "quote", text: quoteLines.join(" ") });
      continue;
    }

    if (line.startsWith("- ")) {
      const items: string[] = [];
      while (index < lines.length) {
        const nextLine = (lines[index] ?? "").trim();
        if (!nextLine.startsWith("- ")) break;
        items.push(nextLine.slice(2).trim());
        index += 1;
      }
      blocks.push({ type: "list", items });
      continue;
    }

    if (isImplicitHeading(line)) {
      blocks.push({ type: "h3", text: line });
      index += 1;
      continue;
    }

    const paragraphLines: string[] = [line];
    index += 1;
    while (index < lines.length) {
      const nextLine = (lines[index] ?? "").trim();
      if (
        !nextLine ||
        nextLine === "---" ||
        nextLine.startsWith("# ") ||
        nextLine.startsWith("## ") ||
        nextLine.startsWith("### ") ||
        nextLine.startsWith("- ") ||
        nextLine.startsWith("> ") ||
        isImplicitHeading(nextLine)
      ) {
        break;
      }
      paragraphLines.push(nextLine);
      index += 1;
    }
    blocks.push({ type: "paragraph", text: paragraphLines.join(" ") });
  }

  return blocks;
}

function GuidelineText({ text }: { text: string }) {
  const blocks = parseGuidelineBlocks(text);

  return (
    <div className="space-y-3">
      {blocks.map((block, blockIndex) => {
        const key = `${block.type}-${blockIndex}`;

        if (block.type === "h1") {
          return (
            <h2 key={key} className="text-xl font-semibold tracking-tight text-foreground">
              {block.text}
            </h2>
          );
        }

        if (block.type === "h2") {
          return (
            <h3 key={key} className="pt-2 text-base font-semibold text-foreground">
              {block.text}
            </h3>
          );
        }

        if (block.type === "h3") {
          return (
            <h4 key={key} className="text-sm font-semibold text-foreground">
              {block.text}
            </h4>
          );
        }

        if (block.type === "list") {
          return (
            <ul key={key} className="list-disc space-y-1 pl-5 text-sm leading-6 text-foreground">
              {block.items.map((item, itemIndex) => (
                <li key={`${key}-${itemIndex}`}>{item}</li>
              ))}
            </ul>
          );
        }

        if (block.type === "quote") {
          return (
            <div
              key={key}
              className="rounded-md border border-amber-600/30 bg-amber-600/10 px-3 py-2 text-sm font-medium text-amber-100"
            >
              {block.text}
            </div>
          );
        }

        return (
          <p key={key} className="text-sm leading-6 text-foreground">
            {block.text}
          </p>
        );
      })}
    </div>
  );
}

export function RefereeGuidelineClient({
  isAdmin,
  initialMainRefereeSections,
  initialLineRefereeSections,
}: RefereeGuidelineClientProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabKey>("main");
  const [mainSections, setMainSections] = useState<RefereeGuidelineSection[]>(
    initialMainRefereeSections
  );
  const [lineSections, setLineSections] = useState<RefereeGuidelineSection[]>(
    initialLineRefereeSections
  );
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, startTransition] = useTransition();

  const activeSections = useMemo(
    () => (activeTab === "main" ? mainSections : lineSections),
    [activeTab, mainSections, lineSections]
  );

  const applyToTab = (tab: TabKey, updater: (sections: RefereeGuidelineSection[]) => RefereeGuidelineSection[]) => {
    if (tab === "main") {
      setMainSections((previous) => updater(previous));
      return;
    }

    setLineSections((previous) => updater(previous));
  };

  const addSection = (tab: TabKey) => {
    applyToTab(tab, (previous) => [...previous, createEmptySection()]);
  };

  const removeSection = (tab: TabKey, index: number) => {
    applyToTab(tab, (previous) => previous.filter((_, itemIndex) => itemIndex !== index));
  };

  const moveSection = (tab: TabKey, index: number, direction: "up" | "down") => {
    applyToTab(tab, (previous) => {
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= previous.length) {
        return previous;
      }

      const next = [...previous];
      const [moved] = next.splice(index, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  };

  const updateSection = (
    tab: TabKey,
    index: number,
    field: "text" | "imageUrl",
    value: string
  ) => {
    applyToTab(tab, (previous) =>
      previous.map((section, itemIndex) => {
        if (itemIndex !== index) {
          return section;
        }

        if (field === "text") {
          return {
            ...section,
            text: value,
          };
        }

        return {
          ...section,
          imageUrl: value,
        };
      })
    );
  };

  const saveGuideline = () => {
    setNotice(null);
    startTransition(async () => {
      const result = await saveRefereeGuideline({
        mainRefereeSections: mainSections,
        lineRefereeSections: lineSections,
      });

      if (!result || "error" in result) {
        setNotice({
          type: "error",
          text: result?.error ?? "Failed to save referee guideline.",
        });
        return;
      }

      setNotice({ type: "success", text: "Referee guideline saved." });
      router.refresh();
    });
  };

  return (
    <div className="mt-6 space-y-6">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant={activeTab === "main" ? "default" : "outline"}
          onClick={() => {
            setActiveTab("main");
            setNotice(null);
          }}
        >
          Main referee
        </Button>
        <Button
          type="button"
          size="sm"
          variant={activeTab === "line" ? "default" : "outline"}
          onClick={() => {
            setActiveTab("line");
            setNotice(null);
          }}
        >
          Line referee
        </Button>
      </div>

      {notice ? (
        <div
          className={cn(
            "rounded-lg border px-4 py-3 text-sm",
            notice.type === "success"
              ? "border-emerald-600/30 bg-emerald-600/10 text-emerald-200"
              : "border-red-600/30 bg-red-600/10 text-red-200"
          )}
        >
          {notice.text}
        </div>
      ) : null}

      {isAdmin ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
          <p className="text-sm text-muted-foreground">
            Edit {displayTabLabel(activeTab)} guideline sections. Each section supports text and an optional
            image URL.
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => addSection(activeTab)}
            disabled={pending}
          >
            Add section
          </Button>
        </div>
      ) : null}

      {activeSections.length === 0 ? (
        <div className="rounded-xl border border-border bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
          No guideline content yet.
        </div>
      ) : (
        <div className="space-y-4">
          {activeSections.map((section, index) => (
            <article key={`${activeTab}-${index}`} className="rounded-xl border border-border bg-muted/20 p-4">
              {isAdmin ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-foreground">Section {index + 1}</h3>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => moveSection(activeTab, index, "up")}
                        disabled={pending || index === 0}
                      >
                        Move up
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => moveSection(activeTab, index, "down")}
                        disabled={pending || index === activeSections.length - 1}
                      >
                        Move down
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        onClick={() => removeSection(activeTab, index)}
                        disabled={pending}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>

                  <div className="mt-4 space-y-3">
                    <div className="space-y-2">
                      <Label htmlFor={`${activeTab}-text-${index}`}>Text</Label>
                      <textarea
                        id={`${activeTab}-text-${index}`}
                        className="min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                        value={section.text}
                        onChange={(event) =>
                          updateSection(activeTab, index, "text", event.target.value)
                        }
                        placeholder="Enter guideline text"
                        disabled={pending}
                      />
                    </div>

                    {section.text.trim() ? (
                      <div className="rounded-lg border border-border bg-muted/20 p-3">
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Preview
                        </p>
                        <GuidelineText text={section.text} />
                      </div>
                    ) : null}

                    <div className="space-y-2">
                      <Label htmlFor={`${activeTab}-image-${index}`}>Image URL</Label>
                      <Input
                        id={`${activeTab}-image-${index}`}
                        type="url"
                        value={section.imageUrl ?? ""}
                        onChange={(event) =>
                          updateSection(activeTab, index, "imageUrl", event.target.value)
                        }
                        placeholder="https://example.com/referee-guideline.jpg"
                        disabled={pending}
                      />
                    </div>

                    {section.imageUrl ? (
                      <div className="overflow-hidden rounded-lg border border-border bg-background p-2">
                        <img
                          src={section.imageUrl}
                          alt={`${displayTabLabel(activeTab)} section ${index + 1}`}
                          className="max-h-72 w-full rounded object-contain"
                        />
                      </div>
                    ) : null}
                  </div>
                </>
              ) : (
                <>
                  {section.text ? (
                    <GuidelineText text={section.text} />
                  ) : null}
                  {section.imageUrl ? (
                    <div className={cn(section.text ? "mt-3" : "", "overflow-hidden rounded-lg border border-border bg-background p-2")}>
                      <img
                        src={section.imageUrl}
                        alt={`${displayTabLabel(activeTab)} section ${index + 1}`}
                        className="max-h-96 w-full rounded object-contain"
                      />
                    </div>
                  ) : null}
                </>
              )}
            </article>
          ))}
        </div>
      )}

      {isAdmin ? (
        <div className="flex justify-end">
          <Button type="button" onClick={saveGuideline} disabled={pending}>
            {pending ? "Saving..." : "Save guideline"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
