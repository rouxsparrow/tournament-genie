"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
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

type KnockoutBracketControlsProps = {
  category: "MD" | "WD" | "XD";
  disabled?: boolean;
};

type NoticeState = { type: "success" | "error"; message: string } | null;

export function KnockoutBracketControls({
  category,
  disabled = false,
}: KnockoutBracketControlsProps) {
  const [isPending, startTransition] = useGlobalTransition();
  const router = useRouter();
  const [notice, setNotice] = useState<NoticeState>(null);
  const { beginTask, endTask } = useGlobalLoading();

  useEffect(() => {
    setNotice(null);
  }, [category]);

  async function handleGenerate() {
    setNotice(null);
    const token = beginTask();
    try {
      const response = await fetch("/api/knockout/generate-full", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setNotice({
          type: "error",
          message:
            payload?.message || "Unable to generate bracket. Please try again.",
        });
        return;
      }

      const payload = await response.json().catch(() => null);
      startTransition(() => {
        router.refresh();
        setNotice({
          type: "success",
          message: payload?.message || "Bracket generated.",
        });
      });
    } catch (error) {
      setNotice({
        type: "error",
        message: (error as Error).message || "Unable to generate bracket.",
      });
    } finally {
      endTask(token);
    }
  }

  async function handleClear() {
    setNotice(null);
    const token = beginTask();
    try {
      const params = new URLSearchParams({ category });
      const response = await fetch(`/api/knockout/clear?${params.toString()}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setNotice({
          type: "error",
          message:
            payload?.error || "Unable to clear bracket. Please try again.",
        });
        return;
      }

      startTransition(() => {
        router.refresh();
        setNotice({ type: "success", message: "Bracket cleared." });
      });
    } catch (error) {
      setNotice({
        type: "error",
        message: (error as Error).message || "Unable to clear bracket.",
      });
    } finally {
      endTask(token);
    }
  }

  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={disabled || isPending}
          onClick={handleGenerate}
        >
          Generate Bracket
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button type="button" variant="destructive" disabled={disabled || isPending}>
              Clear Bracket
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Clear {category} Bracket?</AlertDialogTitle>
              <AlertDialogDescription>
                This removes knockout bracket matches, seeds, and generated random draw data.
                This cannot be undone.
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
      </div>

      {notice ? (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            notice.type === "error"
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-emerald-200 bg-emerald-50 text-emerald-700"
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <p>{notice.message}</p>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="inline-flex h-5 w-5 items-center justify-center rounded border border-current/30"
              aria-label="Close message"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
