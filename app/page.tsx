import * as React from "react";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { Cta } from "@/components/sections/cta";
import { Evidence } from "@/components/sections/evidence";
import { Faq } from "@/components/sections/faq";
import { Install } from "@/components/sections/install";
import { Hero } from "@/components/sections/hero";
import { Modes } from "@/components/sections/modes";
import { Pipeline } from "@/components/sections/pipeline";
import { Radius } from "@/components/sections/radius";
import { Rules } from "@/components/sections/rules";
import { Surfaces } from "@/components/sections/surfaces";
import { buildStructuredData } from "@/lib/marketing/structured-data";

export default function HomePage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(buildStructuredData()) }}
      />

      <SiteHeader />

      <main className="grow">
        <Hero />
        <Evidence />
        <Pipeline />
        <Modes />
        <Radius />
        <Surfaces />
        <Install />
        <Rules />
        <Faq />
        <Cta />
      </main>

      <SiteFooter />
    </>
  );
}
