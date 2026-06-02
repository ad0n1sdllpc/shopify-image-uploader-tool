"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import type { ElementType } from "react";
import { useEffect, useState } from "react";

type ThemeMode = "system" | "light" | "dark";

const storageKey = "tile-uploader-theme";

const options: { mode: ThemeMode; label: string; icon: ElementType }[] = [
  { mode: "light", label: "Light theme", icon: Sun },
  { mode: "dark", label: "Dark theme", icon: Moon },
  { mode: "system", label: "Use system theme", icon: Monitor }
];

function isThemeMode(value: string | null): value is ThemeMode {
  return value === "system" || value === "light" || value === "dark";
}

function applyTheme(mode: ThemeMode) {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = mode === "dark" || (mode === "system" && prefersDark);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

export default function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>("system");

  useEffect(() => {
    const saved = window.localStorage.getItem(storageKey);
    const initialMode = isThemeMode(saved) ? saved : "system";
    setMode(initialMode);
    applyTheme(initialMode);
  }, []);

  useEffect(() => {
    applyTheme(mode);
    if (mode !== "system") return;

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => applyTheme("system");
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [mode]);

  function chooseTheme(nextMode: ThemeMode) {
    setMode(nextMode);
    window.localStorage.setItem(storageKey, nextMode);
    applyTheme(nextMode);
  }

  return (
    <div className="inline-flex rounded-md border border-line bg-mist p-1 dark:border-white/10 dark:bg-white/5" aria-label="Theme">
      {options.map((option) => {
        const Icon = option.icon;
        const active = option.mode === mode;
        return (
          <button
            key={option.mode}
            type="button"
            onClick={() => chooseTheme(option.mode)}
            className={`focus-ring rounded p-2 transition ${
              active
                ? "bg-white text-moss shadow-sm dark:bg-white/15 dark:text-white"
                : "text-ink/55 hover:bg-white/70 hover:text-ink dark:text-white/55 dark:hover:bg-white/10 dark:hover:text-white"
            }`}
            title={option.label}
            aria-label={option.label}
            aria-pressed={active}
          >
            <Icon size={16} />
          </button>
        );
      })}
    </div>
  );
}
