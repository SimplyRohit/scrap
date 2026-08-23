import * as React from "react";

import { CopyCommand } from "@/components/ui/copy-command";
import { Accent, Container, Section } from "@/components/ui/primitives";
import { Reveal } from "@/components/ui/reveal";
import { SectionHeading } from "@/components/ui/section-heading";
import { INSTALL_STEPS } from "@/lib/marketing/content";

export function Install() {
  return (
    <Section id="install" className="rule-b bg-panel">
      <Container className="relative py-24 sm:py-28">
        <SectionHeading
          id="install-title"
          label="Install"
          index="07"
          title={
            <>
              Three ways <Accent>in.</Accent>
            </>
          }
          description="One install, and the door you open depends on who is reading the answer — you, a build, or an agent. All three run the same engine against the same index."
        />

        <ol className="mt-14 border-t">
          {INSTALL_STEPS.map((step, i) => (
            <Reveal key={step.name} delay={i * 70}>
              <li className="grid gap-6 border-b py-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:items-start md:gap-12">
                <div className="flex gap-5">
                  <span className="label pt-1 text-foreground/35">[ {step.index} ]</span>

                  <div>
                    <h3 className="text-[17px] font-medium tracking-[-0.02em]">{step.name}</h3>
                    <p className="mt-2.5 max-w-sm text-[14px] leading-relaxed text-muted-foreground">
                      {step.body}
                    </p>
                  </div>
                </div>

                <div className="flex flex-col items-start gap-3">
                  <CopyCommand command={step.command} />

                  {"then" in step ? (
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pl-1">
                      <code className="font-mono text-[12.5px] text-foreground">{step.then}</code>
                      <span className="label text-foreground/35">{step.note}</span>
                    </div>
                  ) : null}
                </div>
              </li>
            </Reveal>
          ))}
        </ol>

        <Reveal delay={210}>
          <p className="mt-10 max-w-2xl text-[14px] leading-relaxed text-muted-foreground">
            No keys needed. The vendor calls a key would pay for are borrowed from the
            deployment — <a
              href="https://brightdata.com/products/web-unlocker"
              target="_blank"
              rel="noreferrer noopener"
              className="link-underline text-foreground"
            >
              Bright Data
            </a>{" "}
            for the pages that refuse a plain request, Voyage for semantic search — while the
            cache, the extraction, and the index stay on the machine that ran the command.
            Nothing about the repository is sent anywhere, and{" "}
            <code className="font-mono text-[13px] text-foreground">RIFT_RELAY_URL=off</code>{" "}
            refuses even that.
          </p>
        </Reveal>
      </Container>
    </Section>
  );
}
