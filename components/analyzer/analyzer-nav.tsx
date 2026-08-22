"use client";

import Link from "next/link";
import * as React from "react";

import { Logo } from "@/components/ui/mark";
import { useScrolled } from "@/hooks/use-scrolled";
import { SITE } from "@/lib/marketing/site";
import { cn } from "@/lib/utils";

export type AnalyzerTab = "analysis" | "sources" | "report";

const TABS: { id: AnalyzerTab; label: string }[] = [
  { id: "analysis", label: "Dashboard" },
  { id: "sources", label: "Sources" },
  { id: "report", label: "Report" },
];

type AnalyzerNavProps = {
  activeTab: AnalyzerTab;
  setActiveTab: (tab: AnalyzerTab) => void;
  sourceCount: number;
  totalBreakings: number;
};

export function AnalyzerNav({
  activeTab,
  setActiveTab,
  sourceCount,
  totalBreakings,
}: AnalyzerNavProps) {
  const scrolled = useScrolled(8);

  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b transition-colors duration-300",
        scrolled ? "border-border bg-paper/85 backdrop-blur-md" : "border-border bg-paper",
      )}
    >
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-6">
        <Link href="/" aria-label={`${SITE.name} — home`} className="shrink-0">
          <Logo />
        </Link>

        <nav aria-label="Views" className="flex items-stretch self-stretch">
          <div role="tablist" aria-label="Analyzer views" className="flex items-stretch">
            {TABS.map((tab) => {
              const selected = activeTab === tab.id;

              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "relative px-3.5 text-[13.5px] transition-colors duration-250",
                    selected ? "text-foreground" : "text-muted-foreground hover:text-muted-foreground",
                  )}
                >
                  {tab.label}
                  <span
                    aria-hidden
                    className={cn(
                      "absolute inset-x-2 bottom-0 h-px origin-center bg-foreground transition-transform duration-350 ease-[cubic-bezier(0.22,1,0.36,1)]",
                      selected ? "scale-x-100" : "scale-x-0",
                    )}
                  />
                </button>
              );
            })}
          </div>
        </nav>

        <div className="ml-auto flex items-center gap-5">
          {totalBreakings > 0 ? (
            <span className="hidden font-mono text-[11.5px] text-critical sm:inline">
              {totalBreakings} breaking
            </span>
          ) : null}

          {sourceCount > 0 ? (
            <span className="hidden font-mono text-[11.5px] text-muted-foreground sm:inline">
              {sourceCount} source{sourceCount === 1 ? "" : "s"}
            </span>
          ) : null}

          <span className="flex items-center gap-2">
            <span className="pulse-dot" aria-hidden />
            <span className="label text-muted-foreground">
              Live
            </span>
          </span>
        </div>
      </div>
    </header>
  );
}
