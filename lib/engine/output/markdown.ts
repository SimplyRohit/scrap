/**
 * Markdown projection (gen.md sections 13, 15, 27).
 *
 * Markdown is an *output format*, generated from indexed knowledge on demand.
 * Nothing here holds state, and nothing downstream reads these documents back —
 * if a fact is not in the index, it cannot appear in a document.
 */

import { categorize, confidenceCaveat, isAssertable } from '../analysis/confidence';
import { applicableKnowledge, type RepositoryImpact, type UsageSite } from '../analysis/repository';
import { isBreaking } from '../analysis/versionDiff';
import { findNode, type KnowledgeGraph } from '../index/graph';
import { compareStrings } from '../semver';
import type { ErrorResolution } from '../errorPipeline';
import { SEVERITY_ORDER, type KnowledgeObject } from '../knowledge';
import type { ManifestResearchResult, PackageResearchResult } from '../pipeline';

function percent(score: number): string {
  return `${Math.round(score * 100)}%`;
}

function codeFence(code: string, language?: string): string {
  return `\`\`\`${language ?? ''}\n${code.trim()}\n\`\`\``;
}

function bySeverityThenConfidence(a: KnowledgeObject, b: KnowledgeObject): number {
  const severity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
  return severity !== 0 ? severity : b.confidence - a.confidence;
}

/** Evidence block (gen.md section 13) — a finding without sources is never rendered. */
function renderEvidence(knowledge: KnowledgeObject): string {
  const lines: string[] = ['### Evidence', ''];

  for (const source of knowledge.sources) {
    const label = source.title || source.domain;
    const anchor = source.sectionAnchor ? `#${source.sectionAnchor}` : '';
    lines.push(`- [${label}](${source.url}${anchor}) — \`${source.sourceType}\``);
    if (source.quotedText) lines.push(`  > ${source.quotedText.replace(/\n+/g, ' ')}`);
  }

  lines.push('', '### Confidence', '', `${percent(knowledge.confidence)} (${categorize(knowledge.confidence)})`);

  const caveat = confidenceCaveat(knowledge.confidence);
  if (caveat) lines.push('', `> ${caveat}`);

  return lines.join('\n');
}

function renderFinding(knowledge: KnowledgeObject, index: number): string {
  const lines: string[] = [
    `## ${index}. ${knowledge.title}`,
    '',
    `**Type:** \`${knowledge.type}\` · **Severity:** ${knowledge.severity}` +
      (knowledge.introduced ? ` · **Introduced in:** ${knowledge.introduced}` : '') +
      (knowledge.fixed ? ` · **Fixed in:** ${knowledge.fixed}` : ''),
    '',
    knowledge.description,
    '',
  ];

  if (knowledge.affectedApis.length > 0) {
    lines.push(`**Affected APIs:** ${knowledge.affectedApis.map((api) => `\`${api}\``).join(', ')}`, '');
  }
  if (knowledge.affectedConfig.length > 0) {
    lines.push(`**Affected configuration:** ${knowledge.affectedConfig.map((key) => `\`${key}\``).join(', ')}`, '');
  }

  if (knowledge.migration.length > 0) {
    lines.push('### Required migration', '');
    for (const step of knowledge.migration) {
      lines.push(`- ${step.description}`);
      if (step.before) lines.push('', 'Replace:', '', codeFence(step.before, step.language));
      if (step.after) lines.push('', step.before ? 'with:' : 'Apply:', '', codeFence(step.after, step.language));
      lines.push('');
    }
  }

  lines.push(renderEvidence(knowledge), '');
  return lines.join('\n');
}

export function renderBreakingChanges(result: PackageResearchResult): string {
  const breaking = result.knowledge.filter(isBreaking).sort(bySeverityThenConfidence);

  const header = [
    `# Breaking changes — ${result.package}`,
    '',
    `**Versions:** ${result.change.fromVersion} → ${result.change.toVersion ?? 'unresolved'}`,
    `**Delta:** ${result.change.delta}`,
    `**Risk:** ${result.risk.level} (${result.risk.score}/100)`,
    '',
  ];

  if (breaking.length === 0) {
    header.push(
      '## No breaking changes found',
      '',
      result.trace.fetched.length === 0
        ? 'No sources could be retrieved for this package. This is **not** evidence that the upgrade is safe.'
        : `Researched ${result.trace.fetched.length} source(s) and found no documented breaking change. ` +
          'Absence of evidence in the sources below is weaker than a stated "no breaking changes".',
      '',
      ...result.trace.fetched.map((source) => `- [${source.title}](${source.url})`),
    );
    return header.join('\n');
  }

  return [...header, ...breaking.map((item, index) => renderFinding(item, index + 1))].join('\n');
}

/**
 * How a site was found changes how much it is worth. A parsed site had its
 * binding resolved through the module graph; a textual one is a name match in a
 * file that imports the package, which is a lead. Only the weaker and the
 * indirect cases are annotated — labelling every resolved line would bury the
 * ones that need a second look.
 */
function siteQualifier(site: UsageSite): string {
  const notes: string[] = [];
  if (site.via === 'textual') notes.push('text match');
  if (site.indirect) notes.push(site.indirect);
  return notes.length > 0 ? ` (${notes.join('; ')})` : '';
}

/**
 * gen.md section 14. Without a correlation pass we say so and list what to grep
 * for; we never present "symbols named in the changelog" as "your affected files".
 */
function renderRepositoryImpact(findings: KnowledgeObject[], impact?: RepositoryImpact): string[] {
  if (!impact) {
    const symbols = [...new Set(findings.flatMap((item) => item.affectedApis))];
    return [
      'No repository was supplied, so impact could not be determined. Search your code for:',
      '',
      ...(symbols.length > 0
        ? symbols.map((symbol) => `- \`${symbol}\``)
        : ['- (no symbols were named in the sources)']),
    ];
  }

  if (!impact.usesPackage) {
    return [`Nothing in \`${impact.repository}\` imports \`${impact.package}\`, across ${impact.scanned.files} scanned files.`];
  }

  if (impact.affectedFiles.length === 0) {
    return [
      `\`${impact.package}\` is imported, but none of the affected symbols appear in ${impact.scanned.files} scanned files.`,
    ];
  }

  const lines = [`${impact.affectedFiles.length} file(s) reference this package or its affected symbols.`, ''];

  const byFile = new Map<string, typeof impact.symbolSites>();
  for (const site of [...impact.symbolSites, ...impact.configSites, ...impact.environmentSites, ...impact.scriptSites]) {
    const bucket = byFile.get(site.file) ?? [];
    bucket.push(site);
    byFile.set(site.file, bucket);
  }

  for (const file of impact.affectedFiles.slice(0, 20)) {
    const sites = byFile.get(file);
    if (!sites || sites.length === 0) continue;

    lines.push(`### ${file}`, '');
    for (const site of sites.slice(0, 6)) {
      lines.push(`- \`${site.symbol}\` at line ${site.line}${siteQualifier(site)} — \`${site.text.slice(0, 120)}\``);
    }
    lines.push('');
  }

  if (impact.scanned.truncated) {
    lines.push('> Scan was truncated; some usages may not be listed.', '');
  }

  return lines;
}

/** gen.md section 15. */
export function renderMigrationPlan(result: PackageResearchResult, impact?: RepositoryImpact): string {
  const { change, risk } = result;
  const findings = result.knowledge.filter(isBreaking).sort(bySeverityThenConfidence);
  const assertable = findings.filter((item) => isAssertable(item.confidence));
  const speculative = findings.filter((item) => !isAssertable(item.confidence));

  const lines: string[] = [
    '# Migration plan',
    '',
    '## Package',
    '',
    result.package,
    '',
    '## Version',
    '',
    `${change.fromVersion} → ${change.toVersion ?? 'unresolved'}`,
    '',
    '## Risk',
    '',
    risk.level,
    '',
    ...risk.rationale.map((reason) => `- ${reason}`),
    '',
    '## Breaking changes',
    '',
  ];

  if (assertable.length === 0) {
    lines.push('None confirmed by an authoritative source.', '');
  } else {
    assertable.forEach((item, index) => {
      lines.push(`${index + 1}. **${item.title}** — ${item.severity}, ${percent(item.confidence)} confidence`);
    });
    lines.push('');
  }

  if (speculative.length > 0) {
    lines.push(
      '### Unconfirmed',
      '',
      'Reported by weaker sources. Verify before acting on these.',
      '',
      ...speculative.map((item) => `- ${item.title} (${percent(item.confidence)})`),
      '',
    );
  }

  lines.push('## Required changes', '');
  const steps = assertable.flatMap((item) =>
    item.migration.map((step) => ({ knowledge: item, step })),
  );

  if (steps.length === 0) {
    lines.push('No mechanical changes were extracted from the sources. Review the breaking changes manually.', '');
  } else {
    steps.forEach(({ knowledge, step }, index) => {
      lines.push(`${index + 1}. ${step.description} — *${knowledge.title}*`);
      if (step.before) lines.push('', codeFence(step.before, step.language));
      if (step.after) lines.push('', codeFence(step.after, step.language));
      lines.push('');
    });
  }

  lines.push('## Repository impact', '', ...renderRepositoryImpact(findings, impact), '',
    '## Validation',
    '',
    'Run:',
    '',
    codeFence('bun test\nbun run typecheck\nbun run build', 'bash'),
    '',
    '## Rollback',
    '',
    `Revert \`${result.package}\` to ${change.fromVersion}, restore the lockfile, and regenerate any generated artifacts.`,
    '',
  );

  return lines.join('\n');
}

/**
 * gen.md section 27: `error-analysis.md`.
 *
 * Written so a reader can tell the difference between "we know what this is"
 * and "this is the closest thing in the index" — the two are never presented
 * in the same voice.
 */
export function renderErrorAnalysis(resolution: ErrorResolution): string {
  const { fingerprint: fp, trace } = resolution;

  const lines: string[] = [
    `# Error analysis — ${fp.package}${fp.packageVersion ? ` ${fp.packageVersion}` : ''}`,
    '',
    '## Error',
    '',
    `**Type:** \`${fp.errorType}\`` +
      (fp.errorCode ? ` · **Code:** \`${fp.errorCode}\`` : '') +
      ` · **Fingerprint:** \`${fp.fingerprint}\``,
    '',
    'Normalized message — machine-specific paths, ids, and line numbers removed so',
    'the same defect on another machine resolves to this same analysis:',
    '',
    codeFence(fp.normalizedMessage),
    '',
  ];

  if (fp.stackSymbols.length > 0) {
    lines.push(`**Stack symbols:** ${fp.stackSymbols.map((s) => `\`${s}\``).join(', ')}`, '');
  }

  lines.push(
    '## Diagnosis',
    '',
    resolution.diagnosis,
    '',
    '## Confidence',
    '',
    `${percent(resolution.confidence)} (${resolution.confidenceCategory})`,
    '',
  );

  if (resolution.caveat) lines.push(`> ${resolution.caveat}`, '');

  if (resolution.likelyCause) {
    lines.push('## Likely cause', '', resolution.likelyCause, '');
  }

  if (resolution.affectedVersions.length > 0) {
    lines.push('## Affected versions', '', ...resolution.affectedVersions.map((v) => `- \`${v}\``), '');
  }

  if (resolution.fixedVersions.length > 0) {
    lines.push(
      '## Fixed in',
      '',
      ...resolution.fixedVersions.map((v) => `- \`${v}\``),
      '',
      '> Upgrading past one of these is usually preferable to changing your own code.',
      '',
    );
  }

  lines.push('## Recommended fix', '');
  if (resolution.fix.length === 0) {
    lines.push(
      'No mechanical fix could be extracted at sufficient confidence. Review the evidence below before changing code.',
      '',
    );
  } else {
    resolution.fix.forEach((step, index) => {
      lines.push(`${index + 1}. ${step.description}`);
      if (step.before) lines.push('', codeFence(step.before, step.language));
      if (step.after) lines.push('', codeFence(step.after, step.language));
      lines.push('');
    });
  }

  lines.push('## Repository impact', '');
  lines.push(
    resolution.repositoryImpact.length > 0
      ? `Search your code for: ${resolution.repositoryImpact.map((s) => `\`${s}\``).join(', ')}`
      : 'No symbols were recovered from the stack trace.',
    '',
  );

  lines.push('## Evidence', '');
  if (resolution.evidence.length === 0) {
    lines.push('Nothing in the index matches this error. The diagnosis above is not evidence-backed.', '');
  } else {
    for (const item of resolution.evidence) {
      const applies = item.appliesToVersion ? '' : ' — ⚠️ does not apply to the reported version';
      lines.push(
        `- **${item.title}** (${percent(item.confidence)}, \`${item.type}\`)${applies}`,
        `  [${item.sourceType}](${item.url})`,
      );
      if (item.quotedText) lines.push(`  > ${item.quotedText.replace(/\n+/g, ' ').slice(0, 300)}`);
    }
    lines.push('');
  }

  lines.push(
    '## How this was researched',
    '',
    trace.servedFromIndex
      ? '- Answered from the knowledge index; no network research was needed.'
      : `- Index hits: ${trace.indexHits}`,
    `- GitHub issues searched: ${trace.issuesSearched}`,
    `- Documents fetched: ${trace.documentsFetched}`,
    `- Knowledge indexed this run: ${trace.knowledgeIndexed}`,
    '',
  );

  if (trace.queriesRun.length > 0) {
    lines.push('Queries run:', '', ...trace.queriesRun.map((q) => `- \`${q.label}\`: ${q.query} (${q.results} results)`), '');
  }
  if (trace.searchUnavailable) {
    lines.push(
      '> Web search returned nothing for every query — likely unconfigured. Coverage is limited to the index and GitHub issues.',
      '',
    );
  }

  return lines.join('\n');
}

/**
 * The caveat has to match what actually happened to this repository. Claiming
 * "aliased imports are not detected" understates a parsed scan; claiming full
 * module-graph resolution overstates a Python or config-heavy one. So the text
 * is assembled from the counts.
 */
function caveatLines(impact: RepositoryImpact): string[] {
  const lines: string[] = [];

  if (impact.scanned.parsed > 0) {
    lines.push(
      `${impact.scanned.parsed} module(s) were parsed, so renamed imports (\`import { render as r }\`),`,
      'namespace members, and barrel re-exports were followed to the name the package',
      'actually exports. Computed access (`obj[name]`) and names shadowed by a local',
      'declaration are reported as leads or dropped, never resolved.',
    );
  }

  if (impact.scanned.unparsed > 0) {
    if (lines.length > 0) lines.push('');
    lines.push(
      `${impact.scanned.unparsed} module(s) could not be parsed and fell back to text matching,`,
      'as do Python, config, and single-file components. Those sites are marked',
      '`text match`: the name appears in a file that imports the package, which is not',
      'the same as a resolved binding.',
    );
  }

  if (lines.length === 0) {
    lines.push(
      'Correlation is gated on import sites. Treat this as a strong lead, not a proof',
      'of complete coverage.',
    );
  }

  return lines;
}

/** gen.md section 27: `repository-impact.md`, as a standalone document. */
export function renderRepositoryImpactDocument(
  impact: RepositoryImpact,
  knowledge: KnowledgeObject[],
): string {
  const applicable = applicableKnowledge(knowledge, impact);

  const lines: string[] = [
    `# Repository impact — ${impact.package}`,
    '',
    `**Repository:** \`${impact.repository}\``,
    `**Scanned:** ${impact.scanned.files} files (${impact.scanned.skipped} skipped)${impact.scanned.truncated ? ' — truncated' : ''}`,
    `**Resolution:** ${impact.scanned.parsed} module(s) parsed, ${impact.scanned.unparsed} matched textually`,
    `**Uses package:** ${impact.usesPackage ? 'yes' : 'no'}`,
    '',
    '## Summary',
    '',
    `- Findings researched: ${knowledge.length}`,
    `- Findings this repository can actually be hit by: ${applicable.length}`,
    `- Files referencing the package or its affected symbols: ${impact.affectedFiles.length}`,
    '',
  ];

  if (!impact.usesPackage) {
    lines.push(
      'Nothing in this repository imports the package, so none of the API-level findings can reach it.',
      'Runtime and configuration requirements may still apply.',
      '',
    );
    return lines.join('\n');
  }

  lines.push(...renderRepositoryImpact(knowledge, impact));

  const categories: Array<[string, typeof impact.symbolSites]> = [
    ['Imports', impact.importSites],
    ['Configuration', impact.configSites],
    ['Environment variables', impact.environmentSites],
    ['Scripts', impact.scriptSites],
  ];

  for (const [heading, sites] of categories) {
    if (sites.length === 0) continue;
    lines.push(`## ${heading}`, '');
    for (const site of sites.slice(0, 30)) {
      lines.push(`- \`${site.file}:${site.line}\` — \`${site.symbol}\``);
    }
    lines.push('');
  }

  lines.push(
    '## Caveat',
    '',
    ...caveatLines(impact),
    '',
  );

  return lines.join('\n');
}

/** gen.md section 27: the manifest-level roll-up. */
export function renderAnalysisSummary(analysis: ManifestResearchResult): string {
  const lines: string[] = [
    `# Upgrade analysis — ${analysis.fileName}`,
    '',
    `Generated ${analysis.createdAt}`,
    '',
    `**Overall:** ${analysis.overallSafety.replace(/_/g, ' ').toLowerCase()}`,
    `**Packages analyzed:** ${analysis.results.length}`,
    `**Knowledge objects:** ${analysis.totalKnowledge}`,
    '',
    '| Package | From | To | Delta | Risk | Findings | Sources |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];

  for (const result of [...analysis.results].sort((a, b) => b.risk.score - a.risk.score)) {
    lines.push(
      `| \`${result.package}\` | ${result.change.fromVersion} | ${result.change.toVersion ?? '—'} | ${result.change.delta} | ${result.risk.level} | ${result.knowledge.filter(isBreaking).length} | ${result.trace.fetched.length} |`,
    );
  }

  if (analysis.warnings.length > 0) {
    lines.push('', '## Warnings', '', ...analysis.warnings.map((warning) => `- ${warning}`));
  }

  return lines.join('\n');
}

export interface GeneratedDocuments {
  'analysis.md': string;
  'migration.md': string;
  'breaking-changes.md': string;
}

export function renderDocuments(
  analysis: ManifestResearchResult,
  /** Correlation results keyed by package name, when a repository was scanned. */
  impacts: Record<string, RepositoryImpact> = {},
): GeneratedDocuments {
  const ranked = [...analysis.results].sort((a, b) => b.risk.score - a.risk.score);

  return {
    'analysis.md': renderAnalysisSummary(analysis),
    'migration.md': ranked.map((result) => renderMigrationPlan(result, impacts[result.package])).join('\n\n---\n\n'),
    'breaking-changes.md': ranked.map(renderBreakingChanges).join('\n\n---\n\n'),
  };
}

/**
 * gen.md section 10: the graph as the tree the spec draws.
 *
 * A node-and-edge list is the right structure to query and the wrong one to
 * read. This renders the same projection the way section 10 illustrates it —
 * package, versions, and what each version introduces or fixes — and says so
 * when a version has nothing attached rather than printing a bare stub.
 */
export function renderKnowledgeGraph(graph: KnowledgeGraph, packageName: string): string {
  const versions = graph.nodes
    .filter((node) => node.type === 'version')
    .sort((a, b) => compareStrings(a.version ?? '', b.version ?? ''));

  // Knowledge that names no version cannot hang off one. It is still knowledge,
  // so it gets its own branch rather than vanishing from the picture.
  const versionIds = new Set(versions.map((node) => node.id));
  const unanchored = graph.nodes.filter(
    (node) =>
      (node.type === 'breaking_change' || node.type === 'change' || node.type === 'error') &&
      !graph.edges.some(
        (edge) =>
          (edge.from === node.id && versionIds.has(edge.to)) ||
          (edge.to === node.id && versionIds.has(edge.from)),
      ),
  );

  if (versions.length === 0 && unanchored.length === 0) {
    return `${packageName}\n └── (no versioned knowledge indexed)`;
  }

  const lines = [packageName];

  versions.forEach((version, index) => {
    const last = index === versions.length - 1 && unanchored.length === 0;
    lines.push(` ${last ? '└──' : '├──'} version ${version.version}`);

    const branch = last ? '    ' : ' │  ';

    // Grouped rather than emitted in edge order: a reader scanning a version
    // wants all of its changes together, not changes interleaved with releases.
    const breakingChanges: string[] = [];
    const changes: string[] = [];
    const errors: string[] = [];
    const fixes: string[] = [];
    const releases: string[] = [];

    for (const edge of graph.edges) {
      if (edge.relation === 'INTRODUCES' && edge.from === version.id) {
        const claim = findNode(graph, edge.to);
        // Breaking and non-breaking are labelled apart, and the breaking ones
        // come first: a tree where a docs fix reads the same as a removed API,
        // or buries it, is worse than no tree.
        if (claim?.type === 'breaking_change') breakingChanges.push(`breaking: ${claim.label}`);
        else if (claim) changes.push(`change: ${claim.label}`);
      }
      if (edge.relation === 'AFFECTS' && edge.to === version.id) {
        const claim = findNode(graph, edge.from);
        if (claim?.type === 'error') errors.push(`known error: ${claim.label}`);
      }
      if (edge.relation === 'FIXED_BY' && edge.to === version.id) {
        const claim = findNode(graph, edge.from);
        if (claim) fixes.push(`fixes: ${claim.label}`);
      }
      if (edge.relation === 'HAS_RELEASE' && edge.from === version.id) {
        const release = findNode(graph, edge.to);
        if (release) releases.push(`release: ${release.label}`);
      }
    }

    const children = [...breakingChanges, ...changes, ...errors, ...fixes, ...releases];

    if (children.length === 0) {
      lines.push(`${branch}   └── (referenced only as a version boundary)`);
      return;
    }

    children.forEach((child, childIndex) => {
      lines.push(`${branch}   ${childIndex === children.length - 1 ? '└──' : '├──'} ${child}`);
    });
  });

  if (unanchored.length > 0) {
    lines.push(' └── (no version stated)');
    unanchored.forEach((node, index) => {
      lines.push(`       ${index === unanchored.length - 1 ? '└──' : '├──'} ${node.label}`);
    });
  }

  return lines.join('\n');
}
