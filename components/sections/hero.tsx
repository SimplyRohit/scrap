import * as React from "react";

import { ButtonArrow, ButtonLink } from "@/components/ui/button";
import { ConsolePreview } from "@/components/ui/console-preview";
import { CountUp } from "@/components/ui/count-up";
import { CopyCommand } from "@/components/ui/copy-command";
import { Accent, Backdrop, Container, Frame, Label } from "@/components/ui/primitives";
import { Reveal } from "@/components/ui/reveal";
import { HERO_STATS } from "@/lib/marketing/content";
import { SITE } from "@/lib/marketing/site";

const FACTS = [
  ["Sources per package", "6"],
  ["Assertion threshold", "0.75"],
  ["Ecosystems", "npm · PyPI"],
] as const;

export function Hero() {
  return (
    <section id="top" className="relative overflow-x-clip pt-14">
      <Backdrop />
      <Frame />

      <Container className="relative pb-14 pt-20 sm:pb-16 sm:pt-28">
        <div className="grid gap-x-16 gap-y-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.8fr)] lg:items-end">
          <div>
            <Reveal>
              <Label index="01">Package migration · error intelligence</Label>
            </Reveal>

            <Reveal delay={60}>
              <h1 className="mt-6 max-w-[16ch] text-[2.75rem] font-medium leading-[0.98] tracking-[-0.045em] sm:text-6xl md:text-[4.25rem]">
                Know what breaks{" "}
                <span className="block text-muted-foreground">
                  <Accent>before</Accent> you upgrade.
                </span>
              </h1>
            </Reveal>

            <Reveal delay={120}>
              <p className="mt-7 max-w-lg text-pretty text-[15.5px] leading-relaxed text-muted-foreground">
                Point Rift at a <code className="font-mono text-foreground">package.json</code>{" "}
                or <code className="font-mono text-foreground">requirements.txt</code>. Every
                dependency is researched against its own changelogs, release notes, and
                migration guides — and every breaking change comes back with the sentence it
                was found in.
              </p>
            </Reveal>
          </div>

          <Reveal delay={200}>
            <dl className="border-t">
              {FACTS.map(([term, value]) => (
                <div key={term} className="flex items-baseline justify-between gap-6 border-b py-4">
                  <dt className="label text-muted-foreground">{term}</dt>
                  <dd className="font-mono text-[15px] tracking-tight">{value}</dd>
                </div>
              ))}
              <p className="pt-4 text-[13px] leading-relaxed text-muted-foreground">
                Deterministic end to end. No model writes a finding, so every claim traces
                back to a sentence someone actually published.
              </p>
            </dl>
          </Reveal>
        </div>

        <Reveal delay={160} className="mt-12 flex flex-wrap items-center gap-x-3 gap-y-4">
          <ButtonLink href="/analyzer">
            Open the analyzer
            <ButtonArrow />
          </ButtonLink>

          <CopyCommand command={SITE.install} />

          <a
            href="#pipeline"
            className="group flex items-center gap-2 text-[13.5px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <span className="link-underline">See how it works</span>
          </a>
        </Reveal>
      </Container>

      <Container className="relative pb-20">
        <Reveal delay={240}>
          <ConsolePreview />
        </Reveal>

        <Reveal delay={300}>
          <dl className="mt-10 grid border-t sm:grid-cols-3">
            {HERO_STATS.map((stat, i) => (
              <div
                key={stat.label}
                className={i > 0 ? "border-l pl-7 pt-5" : "pt-5"}
              >
                <dt className="sr-only">{stat.label}</dt>
                <dd>
                  <span className="block font-mono text-[22px] tracking-tight tabular-nums">
                    <CountUp value={stat.value} decimals={stat.decimals} />
                  </span>
                  <span className="label mt-1.5 block text-muted-foreground">
                    {stat.label}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </Reveal>
      </Container>
    </section>
  );
}
