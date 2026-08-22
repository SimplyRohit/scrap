"use client";

import * as React from "react";

import { RISK_BAR, RiskBadge, type RiskLevel } from "@/components/ui/risk-badge";
import { useInView } from "@/hooks/use-in-view";
import { type DependencyRiskReport } from "@/lib/types";
import { cn } from "@/lib/utils";

type DependencyCardProps = {
  report: DependencyRiskReport;
  onOpenCitation: (report: DependencyRiskReport) => void;
  delay?: number;
};

export function DependencyCard({ report, onOpenCitation, delay = 0 }: DependencyCardProps) {
  const { ref, inView } = useInView<HTMLDivElement>({ threshold: 0.15 });

  const { dependency, overallRiskScore, riskLevel, breakingChanges, research } = report;
  const level = (riskLevel ?? "SAFE") as RiskLevel;

  return (
    <div
      ref={ref}
      data-shown={inView}
      className="reveal group/card flex flex-col overflow-hidden border border-border bg-panel transition-colors duration-300 hover:border-foreground/25"
      style={{ "--reveal-delay": `${delay}ms` } as React.CSSProperties}
    >
      {/* One hairline of risk, the width of the card. */}
      <span aria-hidden className={cn("h-0.5 w-full", RISK_BAR[level])} />

      <div className="flex grow flex-col gap-5 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-[15px] font-medium tracking-tight">
              {dependency.name}
            </h3>
            <p className="mt-1 flex items-center gap-2 font-mono text-[11.5px] text-muted-foreground">
              {dependency.currentVersion}
              <span aria-hidden className="text-foreground/35">
                →
              </span>
              <span className="text-foreground">{dependency.targetVersion}</span>
            </p>
          </div>

          <RiskBadge level={level} className="shrink-0" />
        </div>

        <div>
          <div className="flex items-baseline justify-between">
            <span className="label text-muted-foreground">
              Risk
            </span>
            <span className="font-mono text-[11.5px] tabular-nums text-foreground">
              {overallRiskScore}/100
            </span>
          </div>

          <div className="mt-2 h-1 w-full bg-secondary">
            <div
              className={cn(
                "h-full transition-[width] duration-900 ease-[cubic-bezier(0.22,1,0.36,1)]",
                RISK_BAR[level],
              )}
              style={{ width: inView ? `${overallRiskScore}%` : "0%" }}
            />
          </div>
        </div>

        <div className="grow">
          {breakingChanges.length === 0 ? (
            <p className="text-[13px] leading-[1.6] text-muted-foreground">
              {research.sourcesFetched === 0
                ? "No sources could be read. That is not evidence the upgrade is safe."
                : `Nothing breaking in the ${research.sourcesFetched} source${research.sourcesFetched === 1 ? "" : "s"} read.`}
            </p>
          ) : (
            <ul className="space-y-3">
              {breakingChanges.slice(0, 2).map((item) => (
                <li key={item.id}>
                  <p className="truncate text-[13px] font-medium tracking-tight">
                    {item.title}
                  </p>
                  <p className="mt-1 line-clamp-2 text-[12.5px] leading-[1.55] text-muted-foreground">
                    {item.description}
                  </p>
                </li>
              ))}

              {breakingChanges.length > 2 ? (
                <li className="font-mono text-[11px] text-muted-foreground">
                  +{breakingChanges.length - 2} more
                </li>
              ) : null}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border pt-3.5">
          {research.primaryUrl ? (
            <a
              href={research.primaryUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="min-w-0 truncate font-mono text-[10.5px] text-muted-foreground transition-colors duration-200 hover:text-foreground"
            >
              <span className="wipe">{hostOf(research.primaryUrl)}</span>
            </a>
          ) : (
            <span className="font-mono text-[10.5px] text-foreground/35">no source</span>
          )}

          <button
            type="button"
            onClick={() => onOpenCitation(report)}
            className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 font-mono text-[11px] text-muted-foreground transition-colors duration-200 hover:text-foreground"
          >
            {breakingChanges.length} citation{breakingChanges.length === 1 ? "" : "s"}
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
              className="size-3 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/card:translate-x-0.5"
            >
              <path d="M6 3.5 10.5 8 6 12.5" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

/** URLs in this view are long enough to break the layout; the host is enough. */
function hostOf(url: string) {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}
