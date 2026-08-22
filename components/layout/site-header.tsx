"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";

import { ButtonLink } from "@/components/ui/button";
import { Logo } from "@/components/ui/mark";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { useScrolled } from "@/hooks/use-scrolled";
import { PAGE_NAV, SITE } from "@/lib/marketing/site";
import { cn } from "@/lib/utils";

export function SiteHeader() {
  const scrolled = useScrolled(8);
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);

  // On the landing page the logo already points at the current route, so a
  // click would otherwise do nothing. Send it back to the top instead.
  const onLogoClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (pathname !== "/" || event.metaKey || event.ctrlKey || event.shiftKey) return;

    event.preventDefault();
    setOpen(false);

    // No explicit behaviour, so the CSS `scroll-behavior` decides — which means
    // reduced-motion users get an instant jump.
    window.scrollTo({ top: 0 });
    window.history.replaceState(null, "", "/");
  };

  React.useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("keydown", onKeyDown);

    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 border-b transition-colors duration-200",
        scrolled || open ? "border-border bg-paper/90 backdrop-blur-md" : "border-transparent",
      )}
    >
      <div className="mx-auto flex h-14 w-full max-w-[76rem] items-center justify-between gap-6 px-6 sm:px-10">
        <Link
          href="/"
          onClick={onLogoClick}
          aria-label={`${SITE.name} home`}
          className="shrink-0"
        >
          <Logo />
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-7 lg:flex">
          {PAGE_NAV.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="label link-underline text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <a
            href={SITE.repo}
            target="_blank"
            rel="noreferrer noopener"
            className="label hidden items-center gap-1.5 border px-2.5 py-1.5 text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground sm:flex"
          >
            <GithubGlyph />
            Source
          </a>

          <ThemeToggle />

          <ButtonLink href="/analyzer" size="xs" className="hidden sm:inline-flex">
            Open analyzer
          </ButtonLink>

          <button
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="mobile-nav"
            className="grid size-9 place-items-center border text-foreground lg:hidden"
          >
            <span className="relative block h-2.5 w-4" aria-hidden>
              <span
                className={cn(
                  "absolute left-0 top-0 h-px w-4 bg-current transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                  open && "translate-y-[5px] rotate-45",
                )}
              />
              <span
                className={cn(
                  "absolute bottom-0 left-0 h-px w-4 bg-current transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                  open && "-translate-y-[5px] -rotate-45",
                )}
              />
            </span>
          </button>
        </div>
      </div>

      <div
        id="mobile-nav"
        className={cn(
          "grid overflow-hidden border-border bg-paper transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] lg:hidden",
          open ? "grid-rows-[1fr] border-t" : "grid-rows-[0fr]",
        )}
      >
        <nav aria-label="Mobile" className="min-h-0">
          <ul className="px-6 py-2">
            {PAGE_NAV.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="label block border-b py-4 text-muted-foreground transition-colors hover:text-foreground"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>

          <div className="px-6 pb-4">
            <ButtonLink href="/analyzer" size="sm" className="w-full">
              Open analyzer
            </ButtonLink>
          </div>
        </nav>
      </div>
    </header>
  );
}

function GithubGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden className="size-3.5">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}
