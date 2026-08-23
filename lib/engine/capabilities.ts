/**
 * What this deployment is actually configured to do.
 *
 * Pure environment reads, kept out of `research/` so that a Convex query can
 * report capabilities without importing the fetcher — which is Node-only.
 */

export function brightDataConfigured(): boolean {
  return Boolean(process.env.BRIGHTDATA_API_KEY);
}

export function serpConfigured(): boolean {
  return Boolean(process.env.BRIGHTDATA_API_KEY && (process.env.BRIGHTDATA_SERP_ZONE ?? process.env.BRIGHTDATA_ZONE));
}

export function githubConfigured(): boolean {
  return Boolean(process.env.GITHUB_TOKEN);
}
