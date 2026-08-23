import * as React from "react";

import { ButtonArrow, ButtonLink } from "@/components/ui/button";
import { CopyCommand } from "@/components/ui/copy-command";
import { MarkDrift } from "@/components/ui/mark";
import { Accent, Container, EdgeField, Section } from "@/components/ui/primitives";
import { Reveal } from "@/components/ui/reveal";
import { SITE } from "@/lib/marketing/site";

export function Cta() {
  return (
    <Section id="cta" className="overflow-hidden">
      <EdgeField />

      <Container className="relative py-28 sm:py-36">
        <Reveal>
          <MarkDrift className="size-8" />
        </Reveal>

        <Reveal delay={60}>
          <h2 className="mt-8 max-w-[19ch] text-balance text-[2.5rem] font-medium leading-[1.02] tracking-[-0.04em] sm:text-6xl">
            Read the changelog <Accent>before</Accent> the incident report.
          </h2>
        </Reveal>

        <Reveal delay={120}>
          <p className="mt-7 max-w-lg text-pretty text-[15.5px] leading-relaxed text-muted-foreground">
            Run it on a manifest you already have. It will tell you what changed, cite where
            it read that, and say plainly how much it could not find.
          </p>
        </Reveal>

        <Reveal delay={180}>
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <ButtonLink href="/analyzer" variant="signal" size="lg">
              Open the analyzer
              <ButtonArrow />
            </ButtonLink>
            <CopyCommand command={SITE.install} size="lg" />
          </div>
          <p className="mt-4 text-[13px] text-muted-foreground">
            then <code className="font-mono text-foreground/80">{SITE.command}</code>
          </p>
        </Reveal>
      </Container>
    </Section>
  );
}
