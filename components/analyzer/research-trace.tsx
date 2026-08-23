"use client";

import * as React from "react";

import { CountUp } from "@/components/ui/count-up";
import { Reveal } from "@/components/ui/reveal";
import { type FullBlastRadiusAnalysis, type SourceTransport } from "@/lib/types";
import { cn } from "@/lib/utils";

const TRANSPORT: Record<SourceTransport, { label: string; tone: string }> = {
  brightdata: { label: "Unlocker", tone: "text-high" },
  direct: { label: "Direct", tone: "text-muted-foreground" },
  cache: { label: "Cache", tone: "text-safe" },
  // Release bodies arrive through the GitHub API but are cited as the release
  // page, so the trace has to be able to say which of the two it actually read.
  api: { label: "API", tone: "text-muted-foreground" },
  // Same unlocker, someone else's key. Worth distinguishing: a run that leaned
  // on the relay depends on this deployment staying up and in quota.
  relay: { label: "Relay", tone: "text-high" },
};

export function ResearchTrace({ analysis }: { analysis: FullBlastRadiusAnalysis | null }) {
  if (!analysis) {
    return <Empty />;
  }

  const { reports, researchSummary } = analysis;

  return (
    <div className="flex flex-col gap-10">
      <div className="grid gap-8 border-y border-border py-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-center">
        <Reveal>
          <h2 className="text-[18px] font-medium tracking-[-0.025em]">Research trace</h2>
          <p className="mt-2 max-w-xl text-[13.5px] leading-[1.65] text-muted-foreground">
            Candidates are ranked by authority — migration guides and changelogs before
            release notes, registries before community posts — and read in that order until
            the document budget is spent. Hosts that block automated requests go through
            Bright Data&rsquo;s Web Unlocker; a fresh cached copy is reused rather than
            re-fetched.
          </p>
        </Reveal>

        <Reveal delay={80}>
          <dl className="grid grid-cols-3 border-t border-border">
            {[
              { label: "Read", value: researchSummary.totalSourcesFetched },
              { label: "Bright Data", value: researchSummary.unlockedSourceCount },
              { label: "Cached", value: researchSummary.cacheHits },
            ].map((stat, i) => (
              <div
                key={stat.label}
                className={cn("pt-4", i > 0 && "border-l border-border pl-5")}
              >
                <dt className="label text-muted-foreground">
                  {stat.label}
                </dt>
                <dd className="mt-2 font-mono text-[24px] leading-none tracking-[-0.03em] tabular-nums">
                  <CountUp value={stat.value} />
                </dd>
              </div>
            ))}
          </dl>
        </Reveal>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {reports.map((report, i) => {
          const { dependency, research, sources } = report;

          return (
            <Reveal
              key={dependency.name}
              delay={i * 45}
              className="flex flex-col border border-border bg-panel p-5 transition-colors duration-300 hover:border-foreground/25"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-[14.5px] font-medium tracking-tight">
                    {dependency.name}
                  </h3>
                  <p className="mt-1 label text-[10.5px] text-muted-foreground">
                    {dependency.ecosystem}
                  </p>
                </div>

                <span className="shrink-0 border border-foreground/25 px-1.5 py-0.5 label text-[9.5px] text-muted-foreground">
                  {research.servedFromIndex ? "indexed" : `${research.sourcesFetched} read`}
                </span>
              </div>

              <dl className="mt-4 space-y-2 border-t border-border pt-3.5">
                <Row label="Claims indexed" value={String(research.knowledgeExtracted)} />
                {research.failures > 0 ? (
                  <Row label="Fetch failures" value={String(research.failures)} tone="text-high" />
                ) : null}
              </dl>

              {sources.length > 0 ? (
                <ul className="mt-4 space-y-2.5 border-t border-border pt-3.5">
                  {sources.slice(0, 4).map((source) => {
                    const transport = TRANSPORT[source.transport];

                    return (
                      <li key={source.sourceUrl}>
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "label text-[10px]",
                              transport.tone,
                            )}
                          >
                            {transport.label}
                          </span>
                          <span className="truncate font-mono text-[10.5px] text-muted-foreground">
                            {source.sourceType}
                          </span>
                          <span className="ml-auto shrink-0 font-mono text-[10.5px] text-foreground/35">
                            {source.extractedClaims.length}
                          </span>
                        </div>

                        {source.extractedClaims.length === 0 ? (
                          <p className="mt-0.5 font-mono text-[10px] text-foreground/35">
                            read, but nothing extractable
                          </p>
                        ) : null}
                      </li>
                    );
                  })}

                  {sources.length > 4 ? (
                    <li className="font-mono text-[10.5px] text-foreground/35">
                      +{sources.length - 4} more
                    </li>
                  ) : null}
                </ul>
              ) : null}

              {sources.length === 0 && !research.servedFromIndex ? (
                <p className="mt-4 border-t border-border pt-3.5 text-[12.5px] leading-[1.55] text-high">
                  No sources retrieved — findings are unverified, not absent.
                </p>
              ) : null}
            </Reveal>
          );
        })}
      </div>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="label text-muted-foreground">
        {label}
      </dt>
      <dd className={cn("font-mono text-[11.5px] tabular-nums text-muted-foreground", tone)}>
        {value}
      </dd>
    </div>
  );
}

function Empty() {
  return (
    <div className="border border-border bg-panel px-6 py-20 text-center">
      <p className="text-[16px] font-medium tracking-tight">No research yet</p>
      <p className="mx-auto mt-2 max-w-sm text-[13.5px] leading-[1.65] text-muted-foreground">
        Run an analysis from the dashboard to see which sources were read, how each one was
        retrieved, and what was extracted from it.
      </p>
    </div>
  );
}
