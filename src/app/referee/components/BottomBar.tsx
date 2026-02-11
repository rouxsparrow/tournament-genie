"use client";

import { Button } from "@/components/ui/button";
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

type BottomBarProps = {
  locked: boolean;
  onToggleLock: () => void;
  onReset: () => void;
  onSubmit: () => void;
  submitDisabled: boolean;
  isSubmitting: boolean;
  disabled: boolean;
};

export function BottomBar({
  locked,
  onToggleLock,
  onReset,
  onSubmit,
  submitDisabled,
  isSubmitting,
  disabled,
}: BottomBarProps) {
  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="lg" variant="outline" disabled={disabled}>
            Reset
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset score?</AlertDialogTitle>
            <AlertDialogDescription>
              This will reset the current game score back to 0 - 0.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onReset}>Confirm reset</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Button size="lg" variant="secondary" onClick={onSubmit} disabled={submitDisabled}>
        {isSubmitting ? "Submitting..." : "Submit"}
      </Button>

      <Button size="lg" onClick={onToggleLock} disabled={disabled}>
        {locked ? "Unlock" : "Lock"}
      </Button>
    </div>
  );
}
