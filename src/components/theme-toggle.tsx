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
  const [mode, setMode] = useState<ThemeMode>("light");

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const nextMode =
      stored === "light" || stored === "dark"
        ? stored
        : window.matchMedia?.("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
    setMode(nextMode);
  }, []);

  useEffect(() => {
    applyTheme(mode);
  }, [mode]);

  function toggleTheme() {
    const next = mode === "dark" ? "light" : "dark";
    setMode(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }

  return (
    <Button
      type="button"
      size="icon-sm"
      variant="outline"
      onClick={toggleTheme}
      aria-label="Toggle theme"
      aria-pressed={mode === "dark"}
    >
      {mode === "dark" ? (
        <Moon className="h-4 w-4" />
      ) : (
        <Sun className="h-4 w-4" />
      )}
    </Button>
  );
}
