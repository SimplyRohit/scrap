import { describe, expect, test } from 'bun:test';

import type { RepositoryImpact } from '../analysis/repository';
import type { ErrorResolution } from '../errorPipeline';
import { SOURCE_TRUST, type KnowledgeObject } from '../knowledge';
import {
  renderBreakingChanges,
  renderErrorAnalysis,
  renderMigrationPlan,
  renderRepositoryImpactDocument,
} from '../output/markdown';
import type { PackageResearchResult } from '../pipeline';

function knowledge(overrides: Partial<KnowledgeObject> = {}): KnowledgeObject {
  const now = new Date().toISOString();
  return {
    id: 'k_1',
    type: 'removed_api',
    package: 'demo',
    ecosystem: 'nodejs',
    fromVersion: '1.0.0',
    toVersion: '2.0.0',
    introduced: '2.0.0',
    affected: '>=2.0.0',
    title: '`legacy()` was removed',
    description: '`legacy()` was removed in 2.0.0',
    affectedApis: ['legacy()'],
    affectedConfig: [],
    migration: [{ kind: 'replace', description: 'Use modern()', before: 'legacy()', after: 'modern()' }],
    severity: 'CRITICAL',
    provenance: 'official',
    sources: [
      {
        url: 'https://example.com/releases/2.0.0',
        domain: 'example.com',
        sourceType: 'official_release',
        trustScore: SOURCE_TRUST.official_release,
        retrievedAt: now,
        contentHash: 'h',
        quotedText: '`legacy()` was removed in 2.0.0',
      },
    ],
    confidence: 0.9,
    fingerprint: 'fp_1',
    embedding: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function researchResult(overrides: Partial<PackageResearchResult> = {}): PackageResearchResult {
  return {
    package: 'demo',
    ecosystem: 'nodejs',
    change: {
      package: 'demo',
      fromVersion: '1.0.0',
      toVersion: '2.0.0',
      delta: 'major',
      breakingByPolicy: true,
      dependencyType: 'dependencies',
    },
    metadata: null,
    knowledge: [knowledge()],
    risk: { score: 50, level: 'MEDIUM', rationale: ['major version jump'] },
    trace: {
      planned: 3,
      fetched: [
        {
          url: 'https://example.com/releases/2.0.0',
          sourceType: 'official_release',
          title: 'demo 2.0.0',
          transport: 'direct',
          fromCache: false,
          extracted: 1,
        },
      ],
      failures: [],
      cacheHits: 0,
      extractedBeforeDedupe: 1,
      collapsedByDedupe: 0,
      contradictions: 0,
      usedSearch: false,
      servedFromIndex: false,
    },
    warnings: [],
    ...overrides,
  };
}

function resolution(overrides: Partial<ErrorResolution> = {}): ErrorResolution {
  return {
    fingerprint: {
      package: 'demo',
      packageVersion: '2.0.0',
      errorType: 'TypeError',
      message: 'legacy is not a function',
      normalizedMessage: 'legacy is not a function',
      stackSymbols: ['Object.legacy'],
      environment: {},
      fingerprint: 'fp_err',
    },
    diagnosis: 'TypeError raised by demo 2.0.0.',
    likelyCause: '`legacy()` was removed in 2.0.0',
    fix: [],
    affectedVersions: ['>=2.0.0'],
    fixedVersions: [],
    repositoryImpact: ['Object.legacy'],
    confidence: 0.9,
    confidenceCategory: 'Very High',
    caveat: null,
    evidence: [],
    trace: {
      indexHits: 1,
      servedFromIndex: true,
      queriesRun: [],
      issuesSearched: 0,
      documentsFetched: 0,
      knowledgeIndexed: 0,
      searchUnavailable: false,
    },
    ...overrides,
  };
}

describe('absence of evidence', () => {
  test('no sources read is reported as unverified, not as safe', () => {
    // The failure that matters: "no breaking changes" must never read as
    // "safe to upgrade" when nothing was actually retrieved.
    const doc = renderBreakingChanges(
      researchResult({ knowledge: [], trace: { ...researchResult().trace, fetched: [] } }),
    );

    expect(doc).toContain('not** evidence that the upgrade is safe');
  });

  test('sources read but nothing found is qualified by how many were read', () => {
    const doc = renderBreakingChanges(researchResult({ knowledge: [] }));

    expect(doc).toContain('Researched 1 source');
    expect(doc).not.toContain('not** evidence that the upgrade is safe');
  });
});

describe('migration plan', () => {
  test('separates assertable findings from unconfirmed ones', () => {
    const doc = renderMigrationPlan(
      researchResult({ knowledge: [knowledge({ confidence: 0.4 })] }),
    );

    expect(doc).toContain('Unconfirmed');
    expect(doc).toContain('None confirmed by an authoritative source');
  });

  test('says impact is unknown when no repository was supplied', () => {
    const doc = renderMigrationPlan(researchResult());
    expect(doc).toContain('No repository was supplied');
    expect(doc).toContain('`legacy()`');
  });
});

describe('error analysis', () => {
  test('shows the normalized message, not the raw one', () => {
    const doc = renderErrorAnalysis(resolution());
    expect(doc).toContain('machine-specific paths, ids, and line numbers removed');
    expect(doc).toContain('legacy is not a function');
  });

  test('states plainly when the diagnosis has no evidence behind it', () => {
    const doc = renderErrorAnalysis(resolution({ evidence: [] }));
    expect(doc).toContain('not evidence-backed');
  });

  test('flags evidence that does not apply to the reported version', () => {
    const doc = renderErrorAnalysis(
      resolution({
        evidence: [
          {
            knowledgeId: 'k_1',
            type: 'removed_api',
            title: 'Removed in a later major',
            url: 'https://example.com',
            sourceType: 'official_release',
            confidence: 0.9,
            appliesToVersion: false,
          },
        ],
      }),
    );

    expect(doc).toContain('does not apply to the reported version');
  });

  test('recommends upgrading when a fixing version is known', () => {
    const doc = renderErrorAnalysis(resolution({ fixedVersions: ['2.1.0'] }));
    expect(doc).toContain('Upgrading past one of these is usually preferable');
  });

  test('reports when web search returned nothing at all', () => {
    const doc = renderErrorAnalysis(
      resolution({
        trace: { ...resolution().trace, searchUnavailable: true, servedFromIndex: false },
      }),
    );

    expect(doc).toContain('likely unconfigured');
  });
});

describe('repository impact document', () => {
  const impact = (overrides: Partial<RepositoryImpact> = {}): RepositoryImpact => ({
    package: 'demo',
    repository: '/repo',
    usesPackage: true,
    importSites: [{ file: 'src/a.ts', line: 1, text: "import { legacy } from 'demo'", symbol: 'demo' }],
    symbolSites: [{ file: 'src/a.ts', line: 2, text: 'legacy()', symbol: 'legacy()' }],
    configSites: [],
    environmentSites: [],
    scriptSites: [],
    affectedFiles: ['src/a.ts'],
    affectedSymbols: ['legacy()'],
    applicableKnowledge: ['k_1'],
    scanned: { files: 10, skipped: 0, truncated: false, parsed: 10, unparsed: 0 },
    ...overrides,
  });

  test('stops early when the package is unused', () => {
    const doc = renderRepositoryImpactDocument(impact({ usesPackage: false }), [knowledge()]);

    expect(doc).toContain('Nothing in this repository imports the package');
    // Non-API findings can still apply, and the document says so.
    expect(doc).toContain('Runtime and configuration requirements may still apply');
  });

  test('separates findings researched from findings that can hit this repo', () => {
    const doc = renderRepositoryImpactDocument(impact(), [
      knowledge(),
      knowledge({ id: 'k_2', fingerprint: 'fp_2', affectedApis: ['neverUsed()'] }),
    ]);

    expect(doc).toContain('Findings researched: 2');
    expect(doc).toContain('Findings this repository can actually be hit by: 1');
  });

  test('claims module-graph resolution only for the files that were parsed', () => {
    const doc = renderRepositoryImpactDocument(impact(), [knowledge()]);

    expect(doc).toContain('10 module(s) were parsed');
    expect(doc).toContain('import { render as r }');
    // Nothing fell back, so the document must not hedge as though something did.
    expect(doc).not.toContain('fell back to text matching');
  });

  test('discloses the fallback when some files could not be parsed', () => {
    const doc = renderRepositoryImpactDocument(
      impact({ scanned: { files: 10, skipped: 0, truncated: false, parsed: 6, unparsed: 4 } }),
      [knowledge()],
    );

    expect(doc).toContain('6 module(s) parsed, 4 matched textually');
    expect(doc).toContain('4 module(s) could not be parsed');
  });

  test('marks a textual site so it is not read as a resolved binding', () => {
    const doc = renderRepositoryImpactDocument(
      impact({
        symbolSites: [{ file: 'src/a.py', line: 2, text: 'legacy()', symbol: 'legacy()', via: 'textual' }],
        importSites: [],
        affectedFiles: ['src/a.py'],
      }),
      [knowledge()],
    );

    expect(doc).toContain('(text match)');
  });

  test('discloses indirection rather than presenting it as direct use', () => {
    const doc = renderRepositoryImpactDocument(
      impact({
        symbolSites: [
          {
            file: 'src/a.ts',
            line: 2,
            text: 'oldLegacy()',
            symbol: 'legacy()',
            via: 'parsed',
            indirect: 'via src/lib/barrel.ts',
          },
        ],
      }),
      [knowledge()],
    );

    expect(doc).toContain('(via src/lib/barrel.ts)');
  });
});
