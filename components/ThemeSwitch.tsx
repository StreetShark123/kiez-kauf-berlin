"use client";

import { useEffect, useState } from "react";
import { track } from "@vercel/analytics";

const THEME_STORAGE_KEY = "kiezkauf:theme-preference";
const THEME_EVENT_NAME = "kiezkauf-theme-change";

function applyTheme(theme: "light" | "dark") {
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.style.colorScheme = theme;
  window.dispatchEvent(new CustomEvent(THEME_EVENT_NAME, { detail: { theme } }));
}

export function ThemeSwitch({
  label,
  darkModeLabel,
  lightModeLabel
}: {
  label: string;
  darkModeLabel: string;
  lightModeLabel: string;
}) {
  const [isDark, setIsDark] = useState(false);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(THEME_STORAGE_KEY);
    } catch {
      stored = null;
    }
    const preferred = stored === "dark" || stored === "light" ? stored : media.matches ? "dark" : "light";

    applyTheme(preferred);
    setIsDark(preferred === "dark");
    setIsReady(true);

    const onSystemThemeChange = (event: MediaQueryListEvent) => {
      let current: string | null = null;
      try {
        current = localStorage.getItem(THEME_STORAGE_KEY);
      } catch {
        current = null;
      }
      if (current === "dark" || current === "light") {
        return;
      }
      const next = event.matches ? "dark" : "light";
      applyTheme(next);
      setIsDark(next === "dark");
    };

    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", onSystemThemeChange);
      return () => media.removeEventListener("change", onSystemThemeChange);
    }

    media.addListener(onSystemThemeChange);
    return () => media.removeListener(onSystemThemeChange);
  }, []);

  return (
    <label className="theme-switch" aria-label={`${label}: ${isDark ? darkModeLabel : lightModeLabel}`}>
      <span className="mono theme-switch-label">
        {label}: {isDark ? darkModeLabel : lightModeLabel}
      </span>
      <input
        type="checkbox"
        role="switch"
        aria-label={isDark ? darkModeLabel : lightModeLabel}
        checked={isDark}
        disabled={!isReady}
        onChange={(event) => {
          const next = event.target.checked ? "dark" : "light";
          try {
            localStorage.setItem(THEME_STORAGE_KEY, next);
          } catch {
            // Ignore storage write errors and still apply theme for current session.
          }
          applyTheme(next);
          setIsDark(next === "dark");
          try {
            track("theme_changed", {
              theme: next,
              source: "footer_switch"
            });
          } catch {
            // Ignore analytics errors.
          }
        }}
      />
      <span className="theme-switch-track" aria-hidden="true">
        <span className="theme-switch-thumb" />
      </span>
    </label>
  );
}
