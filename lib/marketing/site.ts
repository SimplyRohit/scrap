export const SITE = {
  name: "Rift",
  legalName: "Rift",
  tagline: "Know what breaks before you upgrade",
  description:
    "Rift researches every dependency against its own changelogs, release notes, and migration guides, extracts the breaking changes, and returns each one with the verbatim sentence it was found in.",
  shortDescription:
    "See what a dependency upgrade breaks before you run it. Every finding carries the sentence it came from.",
  url: "https://rift.vercel.app",
  repo: "https://github.com/SimplyRohit/scrap",
  twitter: "@riftdev",
  // Not `bunx rift`: npm's `rift` is someone else's game maths library, so that
  // line runs a stranger's code. Restore the bunx form only once this package is
  // published under a name we own.
  install: "rift repo . --fail-on HIGH",
  founded: "2025",
} as const;

export const PAGE_NAV = [
  { label: "Evidence", href: "/#evidence" },
  { label: "Pipeline", href: "/#pipeline" },
  { label: "Modes", href: "/#modes" },
  { label: "Radius", href: "/#radius" },
  { label: "FAQ", href: "/#faq" },
] as const;

export const FOOTER_GROUPS = [
  {
    title: "Product",
    links: [
      { label: "Analyzer", href: "/analyzer" },
      { label: "Blast radius", href: "/#radius" },
      { label: "Two modes", href: "/#modes" },
      { label: "Surfaces", href: "/#surfaces" },
    ],
  },
  {
    title: "Engine",
    links: [
      { label: "Pipeline", href: "/#pipeline" },
      { label: "Evidence rules", href: "/#rules" },
      { label: "Known limits", href: "/#rules" },
      { label: "FAQ", href: "/#faq" },
    ],
  },
  {
    title: "Elsewhere",
    links: [
      { label: "Source", href: SITE.repo },
      { label: "Engine reference", href: `${SITE.repo}/blob/main/lib/engine/README.md` },
      { label: "Agent skill", href: `${SITE.repo}/tree/main/skills` },
    ],
  },
] as const;

/** Every indexable route, in one place — sitemap and structured data read this. */
export const ROUTES = [
  { path: "/", priority: 1, changeFrequency: "weekly" },
  { path: "/analyzer", priority: 0.8, changeFrequency: "weekly" },
] as const;
