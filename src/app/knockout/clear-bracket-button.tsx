"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useGlobalTransition } from "@/components/use-global-transition";
import { useGlobalLoading } from "@/components/global-loading-provider";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type ClearBracketButtonProps = {
  category: "MD" | "WD" | "XD";
  series?: "A" | "B";
  disabled?: boolean;
};

export function ClearBracketButton({
  category,
  series,
  disabled,
}: ClearBracketButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useGlobalTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const { beginTask, endTask } = useGlobalLoading();

  const scopeLabel = series ? `Series ${series}` : "Series A and B";
  const isWD = category === "WD";
  const description = series
    ? `This removes all ${category} ${scopeLabel} knockout matches, seeds, and bracket links.`
    : `This removes all ${category} knockout matches, seeds, and bracket links for ${isWD ? "Series A" : "Series A and B"}.`;

  async function handleClear() {
    setNotice(null);
    const params = new URLSearchParams({ category });
    if (series) params.set("series", series);
    const token = beginTask();
    try {
      const response = await fetch(`/api/knockout/clear?${params.toString()}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const message =
          payload?.error || "Unable to clear the bracket. Please try again.";
        setNotice(message);
        return;
      }

      startTransition(() => {
        router.refresh();
      });
      setNotice("Bracket cleared.");
    } catch (error) {
      setNotice((error as Error).message || "Unable to clear the bracket.");
    } finally {
      endTask(token);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            type="button"
            variant="destructive"
            disabled={disabled || isPending}
          >
            Clear Bracket
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear {category} Bracket?</AlertDialogTitle>
            <AlertDialogDescription>
              {description} This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleClear}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Clear Bracket
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {notice ? (
        <span className="text-xs text-muted-foreground">{notice}</span>
      ) : null}
    </div>
  );
}
