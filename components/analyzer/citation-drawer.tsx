"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { RiskBadge, type RiskLevel } from "@/components/ui/risk-badge";
import { type DependencyRiskReport } from "@/lib/types";
import { cn } from "@/lib/utils";

type CitationDrawerProps = {
  report: DependencyRiskReport | null;
  open: boolean;
  onClose: () => void;
};

/**
 * Presentational. The parent decides when the report goes away, so the panel
 * can slide out with its contents still in place.
 */
export function CitationDrawer({ report, open, onClose }: CitationDrawerProps) {
  // One frame between mounting and the open state, so the transform animates
  // from off-screen rather than starting where it ends.
  const [entered, setEntered] = React.useState(false);

  React.useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(open));

    return () => cancelAnimationFrame(frame);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!report) return null;

  const { dependency, breakingChanges, research } = report;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Citations for ${dependency.name}`}
      inert={!entered}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className={cn(
        "fixed inset-0 z-50 flex justify-end bg-foreground/25 backdrop-blur-[2px] transition-opacity duration-300",
        entered ? "opacity-100" : "pointer-events-none opacity-0",
      )}
    >
      <div
        className={cn(
          "flex h-full w-full max-w-2xl flex-col border-l border-border bg-paper",
          "transition-transform duration-350 ease-[cubic-bezier(0.22,1,0.36,1)]",
          entered ? "translate-x-0" : "translate-x-full",
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div className="min-w-0">
            <p className="label text-muted-foreground">
              {dependency.ecosystem}
            </p>
            <h2 className="mt-2 truncate text-[20px] font-medium tracking-[-0.025em]">
              {dependency.name}
            </h2>
            <p className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[11.5px] text-muted-foreground">
              {dependency.currentVersion}
              <span aria-hidden className="text-foreground/35">
                →
              </span>
              <span className="text-foreground">{dependency.targetVersion}</span>
              <span className="text-foreground/35">·</span>
              {research.sourcesFetched} source
              {research.sourcesFetched === 1 ? "" : "s"} · {research.knowledgeExtracted} claim
              {research.knowledgeExtracted === 1 ? "" : "s"}
              {research.servedFromIndex ? (
                <span className="label border px-1.5 py-0.5 text-[9.5px] text-muted-foreground">
                  from index
                </span>
              ) : null}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-8 shrink-0 cursor-pointer place-items-center border border-border text-muted-foreground transition-colors duration-200 hover:border-foreground/25 hover:bg-panel hover:text-foreground"
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              aria-hidden
              className="size-3.5"
            >
              <path d="m4 4 8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        <div className="grow overflow-y-auto px-6 py-6">
          <p className="label text-muted-foreground">
            Breaking changes · {breakingChanges.length}
          </p>

          {breakingChanges.length === 0 ? (
            <p className="mt-5 border border-border bg-panel px-5 py-6 text-[13.5px] leading-[1.65] text-muted-foreground">
              {research.sourcesFetched === 0
                ? "No sources could be read for this package. That is an absence of evidence, not evidence of safety."
                : `Nothing breaking was found in the ${research.sourcesFetched} source${research.sourcesFetched === 1 ? "" : "s"} that were read.`}
            </p>
          ) : (
            <ol className="mt-5 space-y-10">
              {breakingChanges.map((item, i) => (
                <li key={item.id}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 items-baseline gap-3">
                      <span className="shrink-0 font-mono text-[11px] tabular-nums text-foreground/35">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <h3 className="text-[15.5px] font-medium leading-snug tracking-[-0.02em]">
                        {item.title}
                      </h3>
                    </div>
                    <RiskBadge level={item.severity as RiskLevel} className="shrink-0" />
                  </div>

                  <p className="mt-2.5 pl-8 text-[13.5px] leading-[1.7] text-muted-foreground">
                    {item.description}
                  </p>

                  {item.affectedSymbols.length > 0 ? (
                    <ul className="mt-3.5 flex flex-wrap gap-2 pl-8">
                      {item.affectedSymbols.map((symbol) => (
                        <li
                          key={symbol}
                          className="border border-border bg-panel px-2 py-0.5 font-mono text-[11px] text-muted-foreground"
                        >
                          {symbol}
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {item.beforeSnippet || item.afterSnippet ? (
                    <div className="mt-4 grid gap-3 pl-8 sm:grid-cols-2">
                      {item.beforeSnippet ? (
                        <Snippet
                          label={`before · ${dependency.currentVersion}`}
                          code={item.beforeSnippet}
                          tone="border-critical/40"
                        />
                      ) : null}
                      {item.afterSnippet ? (
                        <Snippet
                          label={`after · ${dependency.targetVersion}`}
                          code={item.afterSnippet}
                          tone="border-safe/40"
                        />
                      ) : null}
                    </div>
                  ) : null}

                  <blockquote className="mt-4 ml-8 border-l border-foreground pl-4">
                    <p className="accent text-[15px] leading-[1.6] text-foreground">
                      “{item.citation.quotedText}”
                    </p>
                    <footer className="mt-2">
                      <a
                        href={item.citation.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-[11px] text-muted-foreground transition-colors duration-200 hover:text-foreground"
                      >
                        <span className="wipe">{item.citation.title}</span>
                      </a>
                    </footer>
                  </blockquote>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="flex justify-end border-t border-border px-6 py-4">
          <Button variant="outline" size="sm" onClick={onClose}>
            Close · Esc
          </Button>
        </div>
      </div>
    </div>
  );
}

function Snippet({ label, code, tone }: { label: string; code: string; tone: string }) {
  return (
    <div className={cn("overflow-hidden border bg-panel", tone)}>
      <p className="border-b border-border bg-paper/60 px-3 py-2 label text-[10px] text-muted-foreground">
        {label}
      </p>
      <pre className="overflow-x-auto px-3 py-2.5 font-mono text-[11.5px] leading-[1.7] text-muted-foreground">
        <code>{code}</code>
      </pre>
    </div>
  );
}
