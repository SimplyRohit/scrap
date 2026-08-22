"use client";

import * as React from "react";

import { applyTheme, followsSystem, toggleTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

/**
 * Which glyph shows is decided by CSS off the `.dark` class, not by state, so
 * the server and client render identical markup and there is nothing to
 * reconcile on hydration.
 */
export function ThemeToggle({ className }: { className?: string }) {
  React.useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");

    // Track the OS only while the visitor has not chosen for themselves.
    const onChange = (event: MediaQueryListEvent) => {
      if (followsSystem()) applyTheme(event.matches ? "dark" : "light");
    };

    query.addEventListener("change", onChange);

    return () => query.removeEventListener("change", onChange);
  }, []);

  return (
    <button
      type="button"
      onClick={() => toggleTheme()}
      aria-label="Toggle dark mode"
      title="Toggle dark mode"
      className={cn(
        "grid size-8 shrink-0 place-items-center border text-muted-foreground",
        "transition-colors duration-200 hover:border-foreground/40 hover:text-foreground",
        className,
      )}
    >
      <span className="relative grid size-4 place-items-center">
        <SunGlyph className="absolute rotate-0 scale-100 opacity-100 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] dark:-rotate-90 dark:scale-50 dark:opacity-0" />
        <MoonGlyph className="absolute rotate-90 scale-50 opacity-0 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] dark:rotate-0 dark:scale-100 dark:opacity-100" />
      </span>
    </button>
  );
}

const glyph = "size-4";

function SunGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      aria-hidden
      className={cn(glyph, className)}
    >
      <circle cx="8" cy="8" r="3.1" />
      <path d="M8 1v1.6M8 13.4V15M15 8h-1.6M2.6 8H1M12.95 3.05l-1.13 1.13M4.18 11.82l-1.13 1.13M12.95 12.95l-1.13-1.13M4.18 4.18 3.05 3.05" />
    </svg>
  );
}

function MoonGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={cn(glyph, className)}
    >
      <path d="M13.5 9.6A5.9 5.9 0 0 1 6.4 2.5a5.9 5.9 0 1 0 7.1 7.1Z" />
    </svg>
  );
}
