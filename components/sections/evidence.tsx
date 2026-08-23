import * as React from "react";

import { CitationTrace } from "@/components/diagrams/citation-trace";
import { SourceLadder } from "@/components/diagrams/source-ladder";
import { Accent, Cell, Container, Section } from "@/components/ui/primitives";
import { Reveal } from "@/components/ui/reveal";
import { SectionHeading } from "@/components/ui/section-heading";
import { EVIDENCE_STEPS } from "@/lib/marketing/content";

export function Evidence() {
  return (
    <Section id="evidence" className="rule-b bg-panel">
      <Container className="relative py-24 sm:py-28">
        <SectionHeading
          id="evidence-title"
          label="Evidence"
          index="02"
          title={
            <>
              Every claim carries <Accent>its quote.</Accent>
            </>
          }
          description="Most upgrade tooling summarises. Summaries are where the detail you needed goes to die. Here a finding is stored with the verbatim sentence that produced it, the URL it came from, and how much authority that source has."
        />

        <div className="mt-14 grid border-l border-t sm:grid-cols-3">
          {EVIDENCE_STEPS.map((step, i) => (
            <Reveal key={step.n} delay={i * 70} className="border-b border-r">
              <Cell index={step.n} title={step.title} body={step.body} />
            </Reveal>
          ))}
        </div>

        <Reveal delay={80} className="mt-14">
          <CitationTrace />
          <p className="label mt-4 text-foreground/35">
            One sentence in the source becomes one object in the index
          </p>
        </Reveal>

        <div className="mt-16 grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:items-center lg:gap-16">
          <Reveal>
            <h3 className="text-balance text-[22px] font-medium leading-snug tracking-[-0.025em] sm:text-[26px]">
              Authority is decided <Accent>before</Accent> anything is fetched.
            </h3>
            <p className="mt-4 max-w-md text-[14.5px] leading-relaxed text-muted-foreground">
              Sources are planned as a ladder and read top-down until the document budget
              runs out. The weight a tier carries is the weight it contributes to
              confidence — which is why a forum thread can corroborate a finding but can
              never assert one on its own.
            </p>
            <p className="mt-4 max-w-md text-[14.5px] leading-relaxed text-muted-foreground">
              A tier is only worth its weight if the page can be read at all. Hosts that
              refuse automated requests are fetched through{" "}
              <a
                href="https://brightdata.com/products/web-unlocker"
                target="_blank"
                rel="noreferrer noopener"
                className="link-underline text-foreground"
              >
                Bright Data
              </a>
              , so a 403 costs a transport hop rather than a citation.
            </p>
          </Reveal>

          <Reveal delay={80}>
            <SourceLadder />
          </Reveal>
        </div>
      </Container>
    </Section>
  );
}
