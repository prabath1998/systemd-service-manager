import { useEffect, useState } from "react";
import { getCurrentWindow, type Theme } from "@tauri-apps/api/window";

export type ThemePreference = "system" | "light" | "dark";
const STORAGE_KEY = "theme-preference";

function readPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    // storage unavailable: fall back to following the desktop
  }
  return "system";
}

/**
 * Follows the desktop theme (GTK/Yaru light or dark, as reported by the Tauri window,
 * with `prefers-color-scheme` as a fallback) unless the user picks one explicitly.
 */
export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(readPreference);
  const [systemTheme, setSystemTheme] = useState<Theme>(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
  );

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onMedia = () => setSystemTheme(media.matches ? "dark" : "light");
    media.addEventListener("change", onMedia);

    let unlisten: (() => void) | undefined;
    const win = getCurrentWindow();
    win
      .theme()
      .then((t) => t && setSystemTheme(t))
      .catch(() => {});
    win
      .onThemeChanged(({ payload }) => setSystemTheme(payload))
      .then((fn) => (unlisten = fn))
      .catch(() => {});

    return () => {
      media.removeEventListener("change", onMedia);
      unlisten?.();
    };
  }, []);

  const resolved = preference === "system" ? systemTheme : preference;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolved === "dark");
    document.documentElement.style.colorScheme = resolved;
  }, [resolved]);

  const update = (p: ThemePreference) => {
    setPreference(p);
    try {
      localStorage.setItem(STORAGE_KEY, p);
    } catch {
      // non-persistent preference is fine
    }
  };

  return { preference, resolved, setPreference: update };
}
