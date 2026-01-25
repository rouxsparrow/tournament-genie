"use client";

import { useGlobalLoading } from "@/components/global-loading-provider";

type LoadingIndicatorProps = {
  label?: string;
  className?: string;
};

export function LoadingIndicator({
  label = "Rendering…",
  className = "",
}: LoadingIndicatorProps) {
  return (
    <div
      className={`pointer-events-none fixed right-6 top-6 z-50 flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-semibold text-foreground shadow-sm ${className}`}
      role="status"
      aria-live="polite"
    >
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-foreground/30 border-t-foreground" />
      {label}
    </div>
  );
}

export function GlobalLoadingIndicator() {
  const { pendingCount } = useGlobalLoading();
  if (pendingCount <= 0) return null;
  return <LoadingIndicator />;
}
