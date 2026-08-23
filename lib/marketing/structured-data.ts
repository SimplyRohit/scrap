import { FAQS, SOURCE_TIERS } from "@/lib/marketing/content";
import { SITE } from "@/lib/marketing/site";

/**
 * One `@graph` so the entities can reference each other by `@id` instead of
 * being repeated. Emitted once, from the landing page.
 */
export function buildStructuredData() {
  const organization = {
    "@type": "Organization",
    "@id": `${SITE.url}/#organization`,
    name: SITE.name,
    legalName: SITE.legalName,
    url: SITE.url,
    logo: { "@type": "ImageObject", url: `${SITE.url}/icon.svg` },
    description: SITE.description,
    foundingDate: SITE.founded,
    sameAs: [SITE.repo],
  };

  const website = {
    "@type": "WebSite",
    "@id": `${SITE.url}/#website`,
    url: SITE.url,
    name: SITE.name,
    description: SITE.description,
    publisher: { "@id": `${SITE.url}/#organization` },
    inLanguage: "en-US",
  };

  const application = {
    "@type": "SoftwareApplication",
    "@id": `${SITE.url}/#software`,
    name: SITE.name,
    alternateName: "Rift — dependency blast radius",
    applicationCategory: "DeveloperApplication",
    applicationSubCategory: "Dependency analysis",
    operatingSystem: "Web, macOS, Linux",
    url: SITE.url,
    description: SITE.description,
    codeRepository: SITE.repo,
    publisher: { "@id": `${SITE.url}/#organization` },
    featureList: [
      "Breaking-change research across changelogs, release notes, and migration guides",
      "Verbatim citation attached to every finding",
      "Error fingerprinting and resolution against an indexed knowledge base",
      "Repository correlation to the files that import a changed symbol",
      "CLI with --json and --fail-on for CI gating",
    ],
    offers: {
      "@type": "Offer",
      availability: "https://schema.org/InStock",
      priceCurrency: "USD",
      price: "0",
    },
  };

  const howTo = {
    "@type": "HowTo",
    "@id": `${SITE.url}/#howto`,
    name: "Check the blast radius of a dependency upgrade",
    description:
      "Research every dependency in a manifest against its own documentation and read the breaking changes with their citations.",
    tool: [{ "@type": "HowToTool", name: SITE.name }],
    step: [
      {
        "@type": "HowToStep",
        position: 1,
        name: "Supply a manifest",
        text: "Paste or upload a package.json, requirements.txt, or pyproject.toml. Target versions are resolved against the registry.",
      },
      {
        "@type": "HowToStep",
        position: 2,
        name: "Research each upgrade",
        text: `Sources are read in order of authority — ${SOURCE_TIERS.map((tier) => tier.label.toLowerCase()).join(", ")} — until the document budget is spent.`,
      },
      {
        "@type": "HowToStep",
        position: 3,
        name: "Read the findings with their quotes",
        text: "Each breaking change carries the verbatim sentence it was extracted from, the URL it came from, and a confidence score.",
      },
    ],
  };

  const faq = {
    "@type": "FAQPage",
    "@id": `${SITE.url}/#faq`,
    mainEntity: FAQS.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };

  return {
    "@context": "https://schema.org",
    "@graph": [organization, website, application, howTo, faq],
  };
}

/** Breadcrumbs for anything that is not the landing page. */
export function buildBreadcrumbs(trail: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [{ name: "Home", path: "/" }, ...trail].map((crumb, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: crumb.name,
      item: `${SITE.url}${crumb.path === "/" ? "" : crumb.path}`,
    })),
  };
}
