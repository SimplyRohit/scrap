import * as React from "react";

import { Container, Section } from "@/components/ui/primitives";
import { Reveal } from "@/components/ui/reveal";
import { Logo } from "@/components/ui/mark";
import { WordmarkMatrix } from "@/components/ui/wordmark-matrix";
import { FOOTER_GROUPS, SITE } from "@/lib/marketing/site";

export function SiteFooter() {
  return (
    <Section as="footer" className="rule-t bg-panel">
      <Container className="relative py-16">
        <div className="grid gap-12 md:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)]">
          <Reveal>
            <Logo />
            <p className="mt-4 max-w-[17rem] text-[14px] leading-relaxed text-muted-foreground">
              A package migration and error intelligence index. Researched, indexed, and
              cited — one sentence at a time.
            </p>
            <p className="label mt-5 text-foreground/35">MIT · self-hosted · no account</p>
          </Reveal>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {FOOTER_GROUPS.map((group, i) => (
              <Reveal key={group.title} delay={60 + i * 50}>
                <p className="label text-foreground/35">{group.title}</p>
                <ul className="mt-4 space-y-2.5">
                  {group.links.map((link) => (
                    <li key={link.label}>
                      <a
                        href={link.href}
                        className="link-underline text-[13.5px] text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </Reveal>
            ))}
          </div>
        </div>

        <div className="mt-14 flex flex-col gap-3 border-t pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="label text-foreground/35">
            © {new Date().getFullYear()} {SITE.legalName}
          </p>
          <a
            href={SITE.repo}
            target="_blank"
            rel="noreferrer noopener"
            className="label link-underline text-muted-foreground transition-colors hover:text-foreground"
          >
            View the source
          </a>
        </div>
      </Container>

      {/* The wordmark, as a matrix that lights up under the pointer. */}
      <Container className="relative pb-12">
        <WordmarkMatrix />
      </Container>
    </Section>
  );
}
