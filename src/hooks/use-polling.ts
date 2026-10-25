import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "@/lib/api";

/** Runs `fetcher` now, every `intervalMs` while the page is visible, and on `refresh()`. */
export function usePolling<T>(fetcher: () => Promise<T>, intervalMs: number, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const gen = ++generation.current;
    setLoading(true);
    try {
      const result = await fetcherRef.current();
      if (gen === generation.current) {
        setData(result);
        setError(null);
      }
    } catch (e) {
      if (gen === generation.current) setError(errorMessage(e));
    } finally {
      if (gen === generation.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, intervalMs);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, intervalMs, ...deps]);

  return { data, error, loading, refresh };
}
