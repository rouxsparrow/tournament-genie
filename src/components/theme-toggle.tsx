"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Moon, Sun } from "lucide-react";

type ThemeMode = "light" | "dark";

const STORAGE_KEY = "theme";

function applyTheme(mode: ThemeMode) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", mode === "dark");
}

export function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const [mode, setMode] = useState<ThemeMode>("light");

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") {
      setMode(stored);
      applyTheme(stored);
    } else {
      const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)")
        .matches;
      const fallback = prefersDark ? "dark" : "light";
      setMode(fallback);
      applyTheme(fallback);
    }
    setMounted(true);
  }, []);

  function toggleTheme() {
    const next = mode === "dark" ? "light" : "dark";
    setMode(next);
    window.localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
  }

  return (
    <Button
      type="button"
      size="icon-sm"
      variant="outline"
      onClick={toggleTheme}
      aria-label="Toggle theme"
      aria-pressed={mode === "dark"}
      disabled={!mounted}
    >
      {mode === "dark" ? (
        <Moon className="h-4 w-4" />
      ) : (
        <Sun className="h-4 w-4" />
      )}
    </Button>
  );
}
