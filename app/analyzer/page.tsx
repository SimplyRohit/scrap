import type { Metadata } from "next";
import * as React from "react";

import { ConvexClientProvider } from "@/app/ConvexClientProvider";
import { Analyzer } from "@/components/analyzer/analyzer";
import { SITE } from "@/lib/marketing/site";
import { buildBreadcrumbs } from "@/lib/marketing/structured-data";

export const metadata: Metadata = {
  title: "Analyzer",
  description:
    "Paste a package.json, requirements.txt, or pyproject.toml and read the blast radius of every upgrade — breaking changes, risk scores, and the quoted sentence behind each finding.",
  alternates: { canonical: "/analyzer" },
  openGraph: {
    type: "website",
    siteName: SITE.name,
    title: `Analyzer — ${SITE.name}`,
    description:
      "Read the blast radius of every dependency upgrade in a manifest, with a citation on every finding.",
    url: `${SITE.url}/analyzer`,
  },
};

export default function AnalyzerPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
            buildBreadcrumbs([{ name: "Analyzer", path: "/analyzer" }]),
          ),
        }}
      />

      <ConvexClientProvider>
        <Analyzer />
      </ConvexClientProvider>
    </>
  );
}
