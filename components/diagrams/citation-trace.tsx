"use client";

import * as React from "react";

import { useInView } from "@/hooks/use-in-view";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { CLAIM_TRACES } from "@/lib/marketing/content";
import { cn } from "@/lib/utils";

/** How long each document holds before the next one is traced. */
const DWELL_MS = 5200;

/** Steps within one document, as a fraction of the dwell. */
const MARK_AT = 900;
const OBJECT_AT = 1700;

export function CitationTrace() {
  const { ref, inView } = useInView<HTMLDivElement>({ threshold: 0.35 });
  const reduced = useReducedMotion();

  const [index, setIndex] = React.useState(0);
  const [step, setStep] = React.useState(0);
  const [pinned, setPinned] = React.useState(false);

  const trace = CLAIM_TRACES[index];

  // Advance through mark → extract, then hand over to the next document.
  React.useEffect(() => {
    if (!inView) return;

    // Once a tab has been picked by hand, the walkthrough has served its
    // purpose — every later switch lands on the finished state immediately.
    if (reduced || pinned) {
      const settled = setTimeout(() => setStep(2), 0);

      return () => clearTimeout(settled);
    }

    const timers = [
      setTimeout(() => setStep(0), 0),
      setTimeout(() => setStep(1), MARK_AT),
      setTimeout(() => setStep(2), OBJECT_AT),
      setTimeout(() => setIndex((prev) => (prev + 1) % CLAIM_TRACES.length), DWELL_MS),
    ];

    return () => timers.forEach(clearTimeout);
  }, [index, inView, reduced, pinned]);

  const select = (i: number) => {
    setPinned(true);
    setIndex(i);
  };

  return (
    <div ref={ref} className="overflow-hidden border border-border bg-panel">
      <div className="flex items-stretch border-b border-border bg-paper/60">
        {CLAIM_TRACES.map((item, i) => {
          const selected = i === index;

          return (
            <button
              key={item.file}
              type="button"
              onClick={() => select(i)}
              aria-pressed={selected}
              className={cn(
                "relative border-r border-border px-4 py-3 font-mono text-[11.5px] transition-colors duration-250",
                selected ? "bg-panel text-foreground" : "text-muted-foreground hover:bg-panel/60 hover:text-muted-foreground",
              )}
            >
              {item.file}
              <span
                aria-hidden
                className={cn(
                  "absolute inset-x-0 bottom-0 h-px origin-left bg-foreground transition-transform duration-350 ease-[cubic-bezier(0.22,1,0.36,1)]",
                  selected ? "scale-x-100" : "scale-x-0",
                )}
              />
            </button>
          );
        })}
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        {/* The document, as fetched and normalized. */}
        <div className="border-b border-border p-5 sm:p-6 lg:border-b-0 lg:border-r">
          <p className="label text-muted-foreground">
            Source · {trace.tier}
          </p>

          <div className="mt-4 space-y-3">
            {trace.lines.map((line, i) => {
              const isQuote = i === trace.quoteAt;

              return (
                <p
                  key={line}
                  className={cn(
                    "text-[13.5px] leading-[1.65] transition-colors duration-500",
                    i === 0 && "font-medium tracking-tight",
                    isQuote ? "text-foreground" : "text-foreground/35",
                  )}
                >
                  <span
                    className={cn(isQuote && "marker px-0.5")}
                    data-shown={isQuote && step >= 1}
                  >
                    {line}
                  </span>
                </p>
              );
            })}
          </div>

          <p className="mt-5 border-t border-border pt-3 font-mono text-[11px] text-muted-foreground">
            {trace.source}
          </p>
        </div>

        {/* What the extractor stored, and nothing more than that. */}
        <div className="p-5 sm:p-6">
          <p className="label text-muted-foreground">
            Knowledge object
          </p>

          <div
            className={cn(
              "mt-4 transition-all duration-600 ease-[cubic-bezier(0.22,1,0.36,1)]",
              step >= 2 ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
            )}
          >
            <dl className="space-y-0">
              {[
                ["category", trace.object.category],
                ["version_scope", trace.object.scope],
                ["symbol", trace.object.symbol],
              ].map(([key, value]) => (
                <div
                  key={key}
                  className="flex items-baseline justify-between gap-4 border-b border-border py-2.5"
                >
                  <dt className="font-mono text-[11px] text-muted-foreground">{key}</dt>
                  <dd className="truncate font-mono text-[11.5px] text-foreground">{value}</dd>
                </div>
              ))}

              <div className="border-b border-border py-2.5">
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="font-mono text-[11px] text-muted-foreground">confidence</dt>
                  <dd className="font-mono text-[11.5px] tabular-nums text-foreground">
                    {trace.object.confidence.toFixed(2)}
                  </dd>
                </div>
                <div className="mt-2 h-1 w-full bg-secondary">
                  <div
                    className="h-full bg-foreground transition-[width] duration-900 ease-[cubic-bezier(0.22,1,0.36,1)]"
                    style={{ width: step >= 2 ? `${trace.object.confidence * 100}%` : "0%" }}
                  />
                </div>
              </div>

              <div className="pt-3">
                <dt className="font-mono text-[11px] text-muted-foreground">quote</dt>
                <dd className="accent mt-1.5 text-[14px] leading-[1.55] text-foreground">
                  “{trace.lines[trace.quoteAt]}”
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
