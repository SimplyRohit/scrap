"use client";

import * as React from "react";

import { Accent, Container, Section } from "@/components/ui/primitives";
import { Reveal } from "@/components/ui/reveal";
import { SectionHeading } from "@/components/ui/section-heading";
import { FAQS } from "@/lib/marketing/content";
import { cn } from "@/lib/utils";

export function Faq() {
  const [open, setOpen] = React.useState<number | null>(0);

  return (
    <Section id="faq" className="rule-b bg-panel">
      <Container className="relative py-24 sm:py-28">
        <div className="grid gap-x-16 gap-y-10 lg:grid-cols-[minmax(0,0.6fr)_minmax(0,1fr)]">
          <SectionHeading
            id="faq-title"
            label="FAQ"
            index="08"
            title={
              <>
                The parts people <Accent>ask about twice.</Accent>
              </>
            }
            className="lg:sticky lg:top-24 lg:self-start"
          />

          <Reveal delay={60}>
            <div className="border-t">
              {FAQS.map((faq, i) => {
                const isOpen = open === i;

                return (
                  <div key={faq.q} className="border-b">
                    <h3>
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        aria-controls={`faq-panel-${i}`}
                        id={`faq-trigger-${i}`}
                        onClick={() => setOpen(isOpen ? null : i)}
                        className="group flex w-full items-start justify-between gap-6 py-5 text-left"
                      >
                        <span
                          className={cn(
                            "text-[15px] font-medium leading-snug tracking-[-0.01em] transition-colors duration-300",
                            isOpen ? "text-foreground" : "text-muted-foreground group-hover:text-foreground",
                          )}
                        >
                          {faq.q}
                        </span>

                        <span aria-hidden className="relative mt-1.5 block size-2.5 shrink-0">
                          <span
                            className={cn(
                              "absolute left-0 top-1/2 h-px w-2.5 -translate-y-1/2 transition-colors duration-300",
                              isOpen ? "bg-foreground" : "bg-muted-foreground group-hover:bg-foreground",
                            )}
                          />
                          <span
                            className={cn(
                              "absolute left-1/2 top-0 h-2.5 w-px -translate-x-1/2 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                              isOpen
                                ? "rotate-90 bg-foreground opacity-0"
                                : "bg-muted-foreground group-hover:bg-foreground",
                            )}
                          />
                        </span>
                      </button>
                    </h3>

                    <div
                      id={`faq-panel-${i}`}
                      role="region"
                      aria-labelledby={`faq-trigger-${i}`}
                      className={cn(
                        "grid transition-[grid-template-rows] duration-400 ease-[cubic-bezier(0.22,1,0.36,1)]",
                        isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                      )}
                    >
                      <div className="overflow-hidden">
                        <p
                          className={cn(
                            "max-w-prose pb-5 pr-8 text-[14px] leading-relaxed text-muted-foreground transition-opacity duration-400",
                            isOpen ? "opacity-100 delay-75" : "opacity-0",
                          )}
                        >
                          {faq.a}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Reveal>
        </div>
      </Container>
    </Section>
  );
}
