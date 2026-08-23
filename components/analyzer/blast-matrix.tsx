"use client";

import * as React from "react";

import { DependencyCard } from "@/components/analyzer/dependency-card";
import { CountUp } from "@/components/ui/count-up";
import { Reveal } from "@/components/ui/reveal";
import { type DependencyRiskReport, type FullBlastRadiusAnalysis } from "@/lib/types";
import { cn } from "@/lib/utils";

type BlastMatrixProps = {
  analysis: FullBlastRadiusAnalysis;
  onOpenCitation: (report: DependencyRiskReport) => void;
};

type Filter = "ALL" | "CRITICAL" | "HIGH" | "MEDIUM" | "SAFE";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "CRITICAL", label: "Critical" },
  { key: "HIGH", label: "High" },
  { key: "MEDIUM", label: "Medium" },
  { key: "SAFE", label: "Safe" },
];

const SAFETY_LABEL: Record<string, string> = {
  HIGH_RISK: "High risk",
  MODERATE_RISK: "Moderate",
  LOW_RISK: "Low risk",
  SAFE_TO_UPGRADE: "Safe",
};

const SAFETY_TONE: Record<string, string> = {
  HIGH_RISK: "text-critical",
  MODERATE_RISK: "text-high",
  LOW_RISK: "text-muted-foreground",
  SAFE_TO_UPGRADE: "text-safe",
};

export function BlastMatrix({ analysis, onOpenCitation }: BlastMatrixProps) {
  const [filter, setFilter] = React.useState<Filter>("ALL");

  const filtered = analysis.reports.filter(
    (report) => filter === "ALL" || report.riskLevel === filter,
  );

  return (
    <div className="flex flex-col gap-10">
      <dl className="grid border-y border-border sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Verdict"
          value={SAFETY_LABEL[analysis.overallSafetyRating] ?? "Safe"}
          sub={`${analysis.totalDependencies} dependencies`}
          tone={SAFETY_TONE[analysis.overallSafetyRating] ?? "text-safe"}
        />
        <Stat
          label="Breaking changes"
          value={<CountUp value={analysis.totalBreakingChanges} />}
          sub={`${analysis.criticalCount} critical · ${analysis.highCount} high`}
          tone={analysis.totalBreakingChanges > 0 ? "text-critical" : "text-foreground"}
        />
        <Stat
          label="Sources read"
          value={<CountUp value={analysis.researchSummary.totalSourcesFetched} />}
          sub={`${analysis.researchSummary.cacheHits} from cache`}
        />
        <Stat
          label="Ecosystem"
          value={analysis.ecosystem.toUpperCase()}
          sub="registry-resolved targets"
        />
      </dl>

      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 label text-muted-foreground">
          Filter
        </span>

        {FILTERS.map(({ key, label }) => {
          const active = filter === key;

          return (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              aria-pressed={active}
              className={cn(
                "border px-2.5 py-1 text-[12.5px] transition-colors duration-250 ease-[cubic-bezier(0.22,1,0.36,1)]",
                active
                  ? "border-foreground bg-panel text-foreground"
                  : "border-border text-muted-foreground hover:border-foreground/25 hover:bg-panel hover:text-muted-foreground",
              )}
            >
              {label}
            </button>
          );
        })}

        <span className="ml-auto font-mono text-[11px] text-muted-foreground">
          {filtered.length} package{filtered.length === 1 ? "" : "s"}
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="border border-border bg-panel px-5 py-10 text-center text-[13.5px] text-muted-foreground">
          No packages at this risk level.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((report, i) => (
            <DependencyCard
              key={report.dependency.name}
              report={report}
              onOpenCitation={onOpenCitation}
              delay={i * 45}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  sub: string;
  tone?: string;
}) {
  return (
    <Reveal className="border-border px-1 py-5 sm:border-l sm:px-6 sm:first:border-l-0 sm:first:pl-1 lg:[&:nth-child(3)]:border-l">
      <dt className="label text-muted-foreground">
        {label}
      </dt>
      <dd>
        <span
          className={cn(
            "mt-3 block font-mono text-[26px] leading-none tracking-[-0.03em] tabular-nums",
            tone,
          )}
        >
          {value}
        </span>
        <span className="mt-2 block text-[12px] text-muted-foreground">{sub}</span>
      </dd>
    </Reveal>
  );
}
