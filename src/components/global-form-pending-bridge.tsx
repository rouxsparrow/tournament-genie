"use client";

import { useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { useGlobalLoading } from "@/components/global-loading-provider";

export function GlobalFormPendingBridge() {
  const { pending } = useFormStatus();
  const { beginTask, endTask } = useGlobalLoading();
  const tokenRef = useRef<number | null>(null);

  useEffect(() => {
    if (pending && tokenRef.current === null) {
      tokenRef.current = beginTask();
      return;
    }
    if (!pending && tokenRef.current !== null) {
      endTask(tokenRef.current);
      tokenRef.current = null;
    }
  }, [beginTask, endTask, pending]);

  useEffect(() => {
    return () => {
      if (tokenRef.current !== null) {
        endTask(tokenRef.current);
        tokenRef.current = null;
      }
    };
  }, [endTask]);

  return null;
}
