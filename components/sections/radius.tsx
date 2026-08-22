"use client";

import * as React from "react";

import { BlastRings } from "@/components/diagrams/blast-rings";
import { Accent, Container, Panel, Section } from "@/components/ui/primitives";
import { Reveal } from "@/components/ui/reveal";
import { RISK_BAR, RiskBadge } from "@/components/ui/risk-badge";
import { SectionHeading } from "@/components/ui/section-heading";
import { FINDINGS } from "@/lib/marketing/content";
import { cn } from "@/lib/utils";

export function Radius() {
  const [active, setActive] = React.useState(0);
  const finding = FINDINGS[active];

  return (
    <Section id="radius" className="rule-b">
      <Container className="relative py-24 sm:py-28">
        <SectionHeading
          id="radius-title"
          label="Blast radius"
          index="05"
          title={
            <>
              One manifest in. Every upgrade <Accent>scored and sourced.</Accent>
            </>
          }
          description="Risk is not a star rating. It is a count of the changes that were actually documented between the version you have and the version you would move to — each one clickable, down to the sentence."
        />

        <Reveal delay={80} className="mt-14">
          <Panel corners className="p-7 sm:p-10">
            <div className="-mx-7 overflow-x-auto px-7 sm:mx-0 sm:px-0">
              <div className="min-w-[40rem]">
                <BlastRings />
              </div>
            </div>
          </Panel>
          <p className="label mt-4 text-foreground/35">
            Hover a ring to trace how far one version bump actually reaches
          </p>
        </Reveal>

        <Reveal delay={100} className="mt-16">
          <Panel className="overflow-hidden">
            <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="flex flex-col border-b lg:border-b-0 lg:border-r">
                <div className="flex items-center justify-between border-b bg-paper/60 px-5 py-3">
                  <span className="font-mono text-[11.5px]">package.json</span>
                  <span className="label text-foreground/35">6 dependencies</span>
                </div>

                <ul role="tablist" aria-label="Analysed dependencies" className="grow">
                  {FINDINGS.map((row, i) => {
                    const selected = i === active;

                    return (
                      <li key={row.name}>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={selected}
                          aria-controls="finding-panel"
                          onClick={() => setActive(i)}
                          data-active={selected}
                          className={cn(
                            "row-mark flex w-full items-center gap-4 border-b px-5 py-3.5 pl-6 text-left transition-colors duration-300",
                            selected ? "bg-foreground/[0.045]" : "hover:bg-foreground/[0.025]",
                          )}
                        >
                          <span
                            aria-hidden
                            className={cn(
                              "h-7 w-0.5 shrink-0 transition-opacity duration-300",
                              RISK_BAR[row.risk],
                              selected ? "opacity-100" : "opacity-25",
                            )}
                          />

                          <span className="min-w-0 grow">
                            <span className="flex items-baseline gap-2">
                              <span
                                className={cn(
                                  "truncate font-mono text-[13px] transition-colors duration-300",
                                  selected ? "text-foreground" : "text-muted-foreground",
                                )}
                              >
                                {row.name}
                              </span>
                              <span className="label text-foreground/30">{row.ecosystem}</span>
                            </span>
                            <span className="mt-0.5 block font-mono text-[11px] text-muted-foreground">
                              {row.from} → {row.to}
                            </span>
                          </span>

                          <span className="flex shrink-0 items-center gap-3">
                            <span className="hidden font-mono text-[11px] tabular-nums text-muted-foreground sm:inline">
                              {row.breaking} breaking
                            </span>
                            <RiskBadge level={row.risk} />
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>

              <div id="finding-panel" role="tabpanel" className="flex min-w-0 flex-col">
                <div className="flex items-center justify-between border-b bg-paper/60 px-5 py-3">
                  <span className="font-mono text-[11.5px]">finding.json</span>
                  <span className="label text-foreground/35">{finding.category}</span>
                </div>

                <div className="grow p-6 sm:p-7">
                  <div className="flex items-center gap-3">
                    <RiskBadge level={finding.risk} />
                    <span className="label text-muted-foreground">
                      risk {finding.score}/100
                    </span>
                  </div>

                  <h3 className="mt-4 text-balance text-[19px] font-medium leading-snug tracking-[-0.02em]">
                    {finding.title}
                  </h3>

                  <blockquote className="mt-5 border-l-2 border-signal bg-paper px-4 py-3">
                    <p className="text-[14px] leading-relaxed">“{finding.quote}”</p>
                    <footer className="label mt-2.5 text-foreground/35">
                      {finding.source} · {finding.tier}
                    </footer>
                  </blockquote>

                  <div className="mt-6 border-t pt-4">
                    <p className="label text-foreground/35">Affected symbols</p>
                    <ul className="mt-3 flex flex-wrap gap-2">
                      {finding.symbols.map((symbol) => (
                        <li
                          key={symbol}
                          className="border bg-paper px-2 py-1 font-mono text-[11.5px] text-muted-foreground"
                        >
                          {symbol}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </Panel>

          <p className="label mt-4 text-foreground/35">
            Sample output — select a dependency to read its citation
          </p>
        </Reveal>
      </Container>
    </Section>
  );
}
