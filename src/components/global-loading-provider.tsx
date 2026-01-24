"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

type GlobalLoadingContextValue = {
  pendingCount: number;
  beginTask: () => number;
  endTask: (token: number) => void;
};

const GlobalLoadingContext = createContext<GlobalLoadingContextValue | null>(null);

export function GlobalLoadingProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [pendingCount, setPendingCount] = useState(0);
  const nextTokenRef = useRef(1);
  const activeTokensRef = useRef<Set<number>>(new Set());

  const beginTask = useCallback(() => {
    const token = nextTokenRef.current++;
    activeTokensRef.current.add(token);
    setPendingCount((count) => count + 1);
    return token;
  }, []);

  const endTask = useCallback((token: number) => {
    if (!activeTokensRef.current.has(token)) return;
    activeTokensRef.current.delete(token);
    setPendingCount((count) => Math.max(0, count - 1));
  }, []);

  const value = useMemo(
    () => ({
      pendingCount,
      beginTask,
      endTask,
    }),
    [beginTask, endTask, pendingCount]
  );

  return (
    <GlobalLoadingContext.Provider value={value}>
      {children}
    </GlobalLoadingContext.Provider>
  );
}

export function useGlobalLoading() {
  const ctx = useContext(GlobalLoadingContext);
  if (!ctx) {
    throw new Error("useGlobalLoading must be used within GlobalLoadingProvider");
  }
  return ctx;
}
