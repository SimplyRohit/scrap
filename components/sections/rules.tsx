import * as React from "react";

import { Accent, Container, Section } from "@/components/ui/primitives";
import { Reveal } from "@/components/ui/reveal";
import { SectionHeading } from "@/components/ui/section-heading";
import { LIMITS, RULES } from "@/lib/marketing/content";

export function Rules() {
  return (
    <Section id="rules" className="rule-b bg-panel">
      <Container className="relative py-24 sm:py-28">
        <SectionHeading
          id="rules-title"
          label="Rules & limits"
          index="08"
          title={
            <>
              What it holds to — and what it <Accent>admits it cannot do.</Accent>
            </>
          }
          description="A tool that tells you what breaks is only useful if you can tell when it is guessing. So it does not guess, and the places it falls short are written down next to the places it does not."
        />

        <div className="mt-14 grid gap-12 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-16">
          <div>
            <Reveal>
              <p className="label text-foreground/35">Rules it holds</p>
            </Reveal>

            <ol className="mt-5 border-t">
              {RULES.map((rule, i) => (
                <Reveal
                  key={rule.title}
                  as="li"
                  delay={i * 50}
                  className="row-mark group flex gap-5 border-b py-4 pl-4 transition-colors duration-300 hover:bg-foreground/[0.03]"
                >
                  <span className="label mt-1 shrink-0 text-foreground/35 transition-colors duration-300 group-hover:text-foreground">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span>
                    <span className="block text-[15px] font-medium tracking-[-0.015em]">
                      {rule.title}
                    </span>
                    <span className="mt-1.5 block max-w-lg text-[13.5px] leading-relaxed text-muted-foreground">
                      {rule.body}
                    </span>
                  </span>
                </Reveal>
              ))}
            </ol>
          </div>

          <div>
            <Reveal>
              <p className="label text-foreground/35">Limits it admits</p>
            </Reveal>

            <ul className="mt-5 border-l border-t">
              {LIMITS.map((limit, i) => (
                <Reveal key={limit.title} as="li" delay={i * 60} className="border-b border-r">
                  <div className="cell group p-6">
                    <span className="block text-[14.5px] font-medium tracking-[-0.015em]">
                      {limit.title}
                    </span>
                    <span className="mt-2 block text-[13.5px] leading-relaxed text-muted-foreground">
                      {limit.body}
                    </span>
                  </div>
                </Reveal>
              ))}
            </ul>
          </div>
        </div>
      </Container>
    </Section>
  );
}
