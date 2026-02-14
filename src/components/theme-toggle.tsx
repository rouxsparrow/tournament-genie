"use client";

import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Moon, Sun } from "lucide-react";

type ThemeMode = "light" | "dark";

const STORAGE_KEY = "theme";

function applyTheme(mode: ThemeMode) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", mode === "dark");
  root.style.colorScheme = mode;
}

function resolveThemeMode(): ThemeMode {
  if (typeof document === "undefined") return "dark";
  const root = document.documentElement;
  if (root.classList.contains("dark")) return "dark";
  return "light";
}

export function ThemeToggle() {
  // Hydration-safe mounted signal without useEffect state writes.
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  const [tick, setTick] = useState(0);

  void tick;
  const isDark = hydrated ? resolveThemeMode() === "dark" : true;

  function toggleTheme() {
    if (!hydrated) return;
    const current = resolveThemeMode();
    const next: ThemeMode = current === "dark" ? "light" : "dark";
    applyTheme(next);
    window.localStorage.setItem(STORAGE_KEY, next);
    setTick((value) => value + 1);
  }

  return (
    <Button
      type="button"
      size="icon-sm"
      variant="outline"
      onClick={toggleTheme}
      aria-label="Toggle theme"
      aria-pressed={isDark}
    >
      {isDark ? (
        <Moon className="h-4 w-4" />
      ) : (
        <Sun className="h-4 w-4" />
      )}
    </Button>
  );
}
