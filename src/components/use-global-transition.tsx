"use client";

import { useEffect, useRef, useTransition } from "react";
import { useGlobalLoading } from "@/components/global-loading-provider";

export function useGlobalTransition() {
  const [isPending, startTransition] = useTransition();
  const { beginTask, endTask } = useGlobalLoading();
  const tokenRef = useRef<number | null>(null);

  useEffect(() => {
    if (isPending && tokenRef.current === null) {
      tokenRef.current = beginTask();
      return;
    }
    if (!isPending && tokenRef.current !== null) {
      endTask(tokenRef.current);
      tokenRef.current = null;
    }
  }, [beginTask, endTask, isPending]);

  useEffect(() => {
    return () => {
      if (tokenRef.current !== null) {
        endTask(tokenRef.current);
        tokenRef.current = null;
      }
    };
  }, [endTask]);

  return [isPending, startTransition] as const;
}
