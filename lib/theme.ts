export const THEME_KEY = "rift-theme";

export type Theme = "light" | "dark";

/**
 * Runs before first paint, from a blocking inline script in the document head,
 * so the page is never painted in the wrong theme and then corrected.
 *
 * Kept as a string because it has to execute ahead of hydration. It reads an
 * explicit choice if there is one and falls back to the OS preference.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var s=localStorage.getItem(${JSON.stringify(
  THEME_KEY,
)});var d=s?s==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.classList.toggle("dark",d);}catch(e){}})();`;

/** The theme in effect right now, read from the element the script wrote to. */
export function currentTheme(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

/** Flip, and remember the choice from here on. */
export function toggleTheme(): Theme {
  const next: Theme = currentTheme() === "dark" ? "light" : "dark";

  applyTheme(next);

  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // Private mode or storage disabled — the theme still applies for this page.
  }

  return next;
}

/** True until the visitor picks a side, after which the OS stops deciding. */
export function followsSystem() {
  try {
    return localStorage.getItem(THEME_KEY) === null;
  } catch {
    return true;
  }
}
