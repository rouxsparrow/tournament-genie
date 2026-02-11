"use client";

import { useState } from "react";
import { X } from "lucide-react";

type DismissibleMessageCardProps = {
  message: string;
  variant: "success" | "error";
};

export function DismissibleMessageCard({
  message,
  variant,
}: DismissibleMessageCardProps) {
  const [visible, setVisible] = useState(true);

  if (!visible) return null;

  return (
    <div
      className={`rounded-lg border px-4 py-3 text-sm ${
        variant === "error"
          ? "border-red-200 bg-red-50 text-red-700"
          : "border-emerald-200 bg-emerald-50 text-emerald-700"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p>{message}</p>
        <button
          type="button"
          onClick={() => setVisible(false)}
          className="inline-flex h-5 w-5 items-center justify-center rounded border border-current/30"
          aria-label="Close message"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
