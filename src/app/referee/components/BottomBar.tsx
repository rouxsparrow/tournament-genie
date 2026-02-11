"use client";

import { Button } from "@/components/ui/button";

type BottomBarProps = {
  locked: boolean;
  onToggleLock: () => void;
  onSubmit: () => void;
  submitDisabled: boolean;
  isSubmitting: boolean;
  disabled: boolean;
  hidden?: boolean;
};

export function BottomBar({
  locked,
  onToggleLock,
  onSubmit,
  submitDisabled,
  isSubmitting,
  disabled,
  hidden = false,
}: BottomBarProps) {
  if (hidden) return null;

  return (
    <div className="mt-6 grid grid-cols-2 gap-3 rounded-2xl border border-border bg-card p-4">
      <Button
        size="lg"
        className="w-full"
        variant="secondary"
        onClick={onSubmit}
        disabled={submitDisabled}
      >
        {isSubmitting ? "Submitting..." : "Submit"}
      </Button>

      <Button size="lg" className="w-full" onClick={onToggleLock} disabled={disabled}>
        {locked ? "Unlock" : "Lock"}
      </Button>
    </div>
  );
}
