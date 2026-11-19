"use client";

import { useEffect, useState } from "react";

/**
 * The current time, refreshed on an interval. Returns null until mounted:
 * with cacheComponents, reading the clock during prerender is not allowed,
 * and the value would be stale anyway.
 */
export function useNow(intervalMs = 30_000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
