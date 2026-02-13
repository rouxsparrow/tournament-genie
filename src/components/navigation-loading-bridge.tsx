"use client";

import { useEffect, useMemo, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useGlobalLoading } from "@/components/global-loading-provider";

const NAVIGATION_TIMEOUT_MS = 10000;

function buildSnapshot(pathname: string, searchParams: URLSearchParams) {
  const query = searchParams.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function NavigationLoadingBridge() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { beginTask, endTask } = useGlobalLoading();
  const activeTokenRef = useRef<number | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentSnapshot = useMemo(
    () => buildSnapshot(pathname, searchParams),
    [pathname, searchParams]
  );

  useEffect(() => {
    const clearActiveTask = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      if (activeTokenRef.current !== null) {
        endTask(activeTokenRef.current);
        activeTokenRef.current = null;
      }
    };

    clearActiveTask();
  }, [currentSnapshot, endTask]);

  useEffect(() => {
    const startNavigationTask = () => {
      if (activeTokenRef.current !== null) return;
      const token = beginTask();
      activeTokenRef.current = token;
      timeoutRef.current = setTimeout(() => {
        if (activeTokenRef.current === token) {
          endTask(token);
          activeTokenRef.current = null;
        }
        timeoutRef.current = null;
      }, NAVIGATION_TIMEOUT_MS);
    };

    const handleClick = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const target = event.target;
      if (!(target instanceof Element)) return;

      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.hasAttribute("download")) return;

      const targetAttr = anchor.getAttribute("target");
      if (targetAttr && targetAttr !== "_self") return;

      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;

      let destination: URL;
      try {
        destination = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }

      if (destination.origin !== window.location.origin) return;

      const current = new URL(window.location.href);
      const destinationSnapshot = `${destination.pathname}${destination.search}`;
      const currentSnapshotFromWindow = `${current.pathname}${current.search}`;
      if (destinationSnapshot === currentSnapshotFromWindow) return;

      startNavigationTask();
    };

    const handlePopState = () => {
      startNavigationTask();
    };

    document.addEventListener("click", handleClick, true);
    window.addEventListener("popstate", handlePopState);

    return () => {
      document.removeEventListener("click", handleClick, true);
      window.removeEventListener("popstate", handlePopState);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      if (activeTokenRef.current !== null) {
        endTask(activeTokenRef.current);
        activeTokenRef.current = null;
      }
    };
  }, [beginTask, endTask]);

  return null;
}
