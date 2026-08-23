import * as React from "react";

import { Accent, Container, Section } from "@/components/ui/primitives";
import { Reveal } from "@/components/ui/reveal";
import { SectionHeading } from "@/components/ui/section-heading";
import { SURFACES } from "@/lib/marketing/content";

export function Surfaces() {
  return (
    <Section id="surfaces" className="rule-b">
      <Container className="relative py-24 sm:py-28">
        <SectionHeading
          id="surfaces-title"
          label="Surfaces"
          index="06"
          title={
            <>
              One engine. <Accent>Six ways</Accent> to reach it.
            </>
          }
          description="The website is the demo. The real consumers are a terminal, a CI job, and a coding agent that has to decide what to change and then say whether it worked. All six call the same functions — nothing keeps its own copy of the logic, so an answer cannot be right in one place and wrong in another."
        />

        <div className="mt-14 grid border-l border-t sm:grid-cols-2 lg:grid-cols-3">
          {SURFACES.map((surface, i) => (
            <Reveal key={surface.name} delay={i * 70} className="border-b border-r">
              <div className="cell group flex h-full flex-col p-7">
                <div className="flex items-center justify-between">
                  <span className="label text-foreground/35 transition-colors duration-300 group-hover:text-foreground">
                    [ {surface.index} ]
                  </span>
                  <span className="label border px-2 py-1 text-muted-foreground transition-colors duration-300 group-hover:border-foreground/40 group-hover:text-foreground">
                    {surface.status}
                  </span>
                </div>

                <h3 className="mt-4 text-[17px] font-medium tracking-[-0.02em]">
                  {surface.name}
                </h3>

                <p className="mt-3 text-[14px] leading-relaxed text-muted-foreground">
                  {surface.summary}
                </p>

                <ul className="mt-6 border-t pt-4">
                  {surface.points.map((point) => (
                    <li
                      key={point}
                      className="flex gap-2.5 py-1 font-mono text-[11.5px] text-muted-foreground"
                    >
                      <span aria-hidden className="text-foreground/30">
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
      </Container>
    </Section>
  );
}
