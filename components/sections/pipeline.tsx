import * as React from "react";

import { PipelineFlow } from "@/components/diagrams/pipeline-flow";
import { Accent, Container, Panel, Section } from "@/components/ui/primitives";
import { Reveal } from "@/components/ui/reveal";
import { SectionHeading } from "@/components/ui/section-heading";

export function Pipeline() {
  return (
    <Section id="pipeline" className="rule-b">
      <Container className="relative py-24 sm:py-28">
        <SectionHeading
          id="pipeline-title"
          label="The pipeline"
          index="03"
          title={
            <>
              Markdown is an output. The <Accent>knowledge</Accent> is the artefact.
            </>
          }
          description="Documents are normalized once, into a section tree, and never read back as prose. What downstream sees is a typed knowledge object with a version scope, a category, a confidence score, and a citation."
        />

        <Reveal delay={80} className="mt-14">
          <Panel corners className="p-7 sm:p-10">
            <div className="-mx-7 overflow-x-auto px-7 sm:mx-0 sm:px-0">
              <div className="min-w-[52rem]">
                <PipelineFlow />
              </div>
            </div>
          </Panel>
          <p className="label mt-4 text-foreground/35">
            Eight stages — research only runs when the index cannot answer
          </p>
        </Reveal>
      </Container>
    </Section>
  );
}
