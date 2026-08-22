import * as React from "react";

import { ErrorFingerprint } from "@/components/diagrams/error-fingerprint";
import { Accent, Container, Section } from "@/components/ui/primitives";
import { Reveal } from "@/components/ui/reveal";
import { SectionHeading } from "@/components/ui/section-heading";
import { MODES } from "@/lib/marketing/content";

export function Modes() {
  return (
    <Section id="modes" className="rule-b bg-panel">
      <Container className="relative py-24 sm:py-28">
        <SectionHeading
          id="modes-title"
          label="Two modes"
          index="04"
          title={
            <>
              Before the upgrade, and <Accent>after it goes wrong.</Accent>
            </>
          }
          description="The same index answers both. One asks what a version bump will do to you; the other asks which version bump already did."
        />

        <div className="mt-14 grid border-l border-t md:grid-cols-2">
          {MODES.map((mode, i) => (
            <Reveal key={mode.name} delay={i * 80} className="border-b border-r">
              <div className="cell group flex h-full flex-col p-7">
                <span className="label text-foreground/35 transition-colors duration-300 group-hover:text-foreground">
                  [ {mode.index} ]
                </span>

                <h3 className="mt-4 text-[17px] font-medium tracking-[-0.02em]">
                  {mode.name}
                </h3>

                <p className="mt-3 max-w-md text-[14px] leading-relaxed text-muted-foreground">
                  {mode.lede}
                </p>

                <pre className="mt-6 overflow-x-auto border bg-paper px-4 py-3 font-mono text-[12px] leading-relaxed text-muted-foreground">
                  <code>
                    <span className="select-none text-foreground/35">$ </span>
                    {mode.command}
                  </code>
                </pre>

                <ul className="mt-6 border-t pt-4">
                  {mode.points.map((point) => (
                    <li
                      key={point}
                      className="flex gap-2.5 py-1.5 text-[13.5px] leading-snug text-muted-foreground"
                    >
                      <span aria-hidden className="font-mono text-foreground/30">
                        /
                      </span>
                      {point}
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={120} className="mt-14">
          <ErrorFingerprint />
          <p className="label mt-4 text-foreground/35">
            Error mode — application frames are stripped before the trace is fingerprinted
          </p>
        </Reveal>
      </Container>
    </Section>
  );
}
