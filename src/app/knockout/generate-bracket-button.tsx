"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useGlobalTransition } from "@/components/use-global-transition";
import { useGlobalLoading } from "@/components/global-loading-provider";

type GenerateBracketButtonProps = {
  category: "MD" | "WD" | "XD";
  series: "A" | "B";
  disabled?: boolean;
  exists?: boolean;
};

export function GenerateBracketButton({
  category,
  series,
  disabled,
  exists,
}: GenerateBracketButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useGlobalTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const { beginTask, endTask } = useGlobalLoading();

  async function handleGenerate() {
    setNotice(null);
    const token = beginTask();
    try {
      const response = await fetch("/api/knockout/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, series }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        if (response.status === 409 && payload?.error === "BRACKET_EXISTS") {
          setNotice("Bracket already exists. Use Clear Bracket to regenerate.");
          return;
        }
        setNotice(
          payload?.message || "Unable to generate bracket. Please try again."
        );
        return;
      }

      startTransition(() => {
        router.refresh();
      });
      setNotice(`Series ${series} bracket generated.`);
    } catch (error) {
      setNotice((error as Error).message || "Unable to generate bracket.");
    } finally {
      endTask(token);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="outline"
        disabled={disabled || isPending || Boolean(exists)}
        onClick={handleGenerate}
      >
        Generate Series {series} Bracket
      </Button>
      {exists ? (
        <span className="text-xs text-muted-foreground">
          Bracket already exists. Use Clear Bracket to regenerate.
        </span>
      ) : null}
      {notice ? <span className="text-xs text-muted-foreground">{notice}</span> : null}
    </div>
  );
}
