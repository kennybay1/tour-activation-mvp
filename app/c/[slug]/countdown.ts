"use client";

import { useEffect, useRef, useState } from "react";

// Days/hours/minutes above an hour remaining, minutes:seconds below.
export function formatCountdown(msRemaining: number): string {
  if (msRemaining <= 0) return "0:00";
  const totalSeconds = Math.floor(msRemaining / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (msRemaining >= 3_600_000) {
    return days > 0 ? `${days}d ${hours}h ${minutes}m` : `${hours}h ${minutes}m`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

// Client clocks are frequently wrong. Measures the gap between this
// browser's clock and the server's at page load (with a round-trip-time
// correction, assuming symmetric latency) so every countdown on the page
// can be computed against corrected time instead of raw Date.now(). Defaults
// to 0 (trust the client clock) until the one-shot fetch resolves.
export function useClockOffsetMs(): number {
  const [offsetMs, setOffsetMs] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const t0 = Date.now();
    fetch("/api/server-time", { cache: "no-store" })
      .then((res) => res.json())
      .then((json: { now: string }) => {
        if (cancelled) return;
        const t1 = Date.now();
        const rtt = t1 - t0;
        const serverNowAtT1 = new Date(json.now).getTime() + rtt / 2;
        setOffsetMs(serverNowAtT1 - t1);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return offsetMs;
}

// A single ticking "corrected now", shared by every countdown on the page —
// re-reads the wall clock every second rather than incrementing a counter,
// so it can't drift and self-corrects immediately if the tab was backgrounded
// (browsers throttle background intervals) or the offset above updates.
export function useCorrectedNow(offsetMs: number, enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now() + offsetMs);
  const offsetRef = useRef(offsetMs);
  offsetRef.current = offsetMs;

  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now() + offsetRef.current);
    const id = setInterval(() => setNow(Date.now() + offsetRef.current), 1000);
    return () => clearInterval(id);
  }, [enabled]);

  return now;
}
