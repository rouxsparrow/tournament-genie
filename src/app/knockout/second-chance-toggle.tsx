"use client";

import { useRef } from "react";
import { toggleSecondChanceEnabled } from "@/app/knockout/actions";
import { GlobalFormPendingBridge } from "@/components/global-form-pending-bridge";

type SecondChanceToggleProps = {
  category: "MD" | "WD" | "XD";
  enabled: boolean;
  disabled?: boolean;
};

export function SecondChanceToggle({
  category,
  enabled,
  disabled = false,
}: SecondChanceToggleProps) {
  const formRef = useRef<HTMLFormElement | null>(null);

  return (
    <form action={toggleSecondChanceEnabled} ref={formRef}>
      <GlobalFormPendingBridge />
      <input type="hidden" name="category" value={category} />
      <label className="flex items-center gap-3 text-sm text-foreground">
        <span>Second Chance Mode</span>
        <span className="relative inline-flex items-center">
          <input
            type="checkbox"
            name="secondChanceEnabled"
            defaultChecked={enabled}
            disabled={disabled}
            onChange={() => formRef.current?.requestSubmit()}
            className="peer sr-only"
          />
          <span className="relative h-5 w-9 rounded-full border border-border bg-muted transition-colors peer-checked:bg-foreground peer-disabled:opacity-50" />
          <span className="pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-background transition-transform peer-checked:translate-x-4 peer-disabled:opacity-50" />
        </span>
      </label>
    </form>
  );
}
