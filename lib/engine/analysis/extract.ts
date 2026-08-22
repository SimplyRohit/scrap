/**
 * Knowledge extraction (gen.md section 6).
 *
 * Turns a normalized document into `KnowledgeObject`s. This is deliberately
 * deterministic and quote-anchored: every object carries the verbatim sentence it
 * came from, so section 13's "never let the LLM invent a migration" holds by
 * construction rather than by prompt discipline. An LLM refinement pass can be
 * layered on top (see `refineWithModel` seam at the bottom) but may only rewrite
 * prose — it cannot introduce a claim that has no quoted source.
 */

import { normalizeForHash, shortHash } from '../hash';
import {
  severityForType,
  type Ecosystem,
  type KnowledgeObject,
  type KnowledgeType,
  type MigrationStep,
  type Severity,
  type SourceRef,
} from '../knowledge';
import { affectedRange, isInWindow } from '../semver';
import { scoreConfidence } from './confidence';
import type { CodeBlock, DocumentSection, NormalizedDocument } from './normalize';

export interface ExtractionContext {
  package: string;
  ecosystem: Ecosystem;
  /** Version this document describes, when known (e.g. a release tag). */
  documentVersion?: string;
  fromVersion?: string;
  toVersion?: string;
  source: SourceRef;
  /**
   * Ceiling on claims kept from one document. Large projects publish release
   * notes containing hundreds of PR bullets; without a cap the index fills with
   * "fix: skip turbopack build test" and buries the changes that break callers.
   */
  maxClaims?: number;
}

const DEFAULT_MAX_CLAIMS = 60;

/** Retention priority when a document exceeds `maxClaims`. */
function claimValue(knowledge: KnowledgeObject): number {
  const typeRank: Partial<Record<KnowledgeType, number>> = {
    breaking_change: 0,
    removed_api: 0,
    renamed_api: 1,
    runtime_requirement: 1,
    dependency_requirement: 1,
    deprecated_api: 2,
    configuration_change: 2,
    environment_change: 2,
    security_fix: 2,
    behavior_change: 3,
    cli_change: 3,
    migration_example: 4,
    error_solution: 4,
    new_api: 5,
    bug_fix: 6,
    performance_change: 6,
  };

  const base = typeRank[knowledge.type] ?? 5;
  // Within a tier, a claim naming a symbol or carrying a migration is worth more.
  const specificity = (knowledge.affectedApis.length > 0 ? 0.4 : 0) + (knowledge.migration.length > 0 ? 0.2 : 0);
  return base - specificity;
}

/**
 * Ordered classification rules — first match wins, so the most specific and most
 * consequential patterns come first.
 */
/**
 * A security claim needs security substance, not the word.
 *
 * The bare token `security` matched "Update security.md" and filed a
 * documentation edit as a HIGH-severity security fix.
 */
const SECURITY_SUBSTANCE =
  /\bCVE-\d{4}-\d+\b|\bGHSA-[\w-]+\b|\[security\]|security (fix|advisory|vulnerabilit|issue|patch|release|update)|\bvulnerabilit|\bexploit\b|\bXSS\b|\bCSRF\b|prototype pollution|\bRCE\b/i;

const CLASSIFIERS: Array<{ type: KnowledgeType; pattern: RegExp }> = [
  { type: 'security_fix', pattern: SECURITY_SUBSTANCE },
  { type: 'removed_api', pattern: /\b(has been|have been|was|were|is|are)?\s*removed\b|\bno longer (exists?|available|supported|works?)\b|\bdropped support\b|\bdeleted\b/i },
  { type: 'renamed_api', pattern: /\brenamed\b|\bnow (called|named)\b|\bhas been renamed to\b/i },
  { type: 'deprecated_api', pattern: /\bdeprecat/i },
  { type: 'runtime_requirement', pattern: /\b(node(\.js)?|python|bun|deno)\s*(>=|>|version)?\s*\d+(\.\d+)?\b.*(required|minimum|no longer|support)|minimum (required )?(node|python) version/i },
  { type: 'dependency_requirement', pattern: /\bpeer dependenc|requires? [\w@/-]+ (>=|\^|version)\s*\d/i },
  { type: 'environment_change', pattern: /\benv(ironment)? variable\b|\b[A-Z][A-Z0-9_]{4,}\b\s*(is|has|was|must)/ },
  { type: 'cli_change', pattern: /\b(cli|command[- ]line)\b|\b(npx|npm run|yarn|pnpm|bun|pip|poetry)\s+[\w:-]+\b.*(chang|remov|renam|replac)/i },
  { type: 'configuration_change', pattern: /\b(config(uration)?|option|setting|flag|field)\b.*\b(chang|remov|renam|replac|default|require|move)/i },
  { type: 'behavior_change', pattern: /\bdefaults? (to|is|are|now|changed)\b|\bnow (returns?|throws?|behaves?|resolves?|emits?)\b|\bbehaviou?r (has )?chang/i },
  // "breaking" must appear as an announcement ("[Breaking] …", "breaking: …",
  // "BREAKING CHANGE: …"), not incidentally ("fix a bug breaking the build").
  { type: 'breaking_change', pattern: /(^|[\s(])\[?breaking( changes?)?\]?\s*[:\-—]|breaking change|\bincompatib|\bmust (now )?(be )?(update|change|migrate)/i },
  { type: 'new_api', pattern: /\b(added|introduces?|new)\b.*\b(api|option|method|hook|command|export)\b/i },
  { type: 'performance_change', pattern: /\b(faster|slower|performance|memory usage|throughput)\b/i },
  { type: 'bug_fix', pattern: /\bfix(ed|es)?\b/i },
];

/** Headings that put a whole section in scope for extraction. */
const RELEVANT_HEADING = /breaking|migrat|upgrad|remov|deprecat|renam|incompatib|what'?s new|changes|release/i;

/**
 * Maintenance sections. Release notes routinely say "Removed incorrect argument
 * for X (#4656)" under "Bug Fixes" — read literally that classifies as a removed
 * API, which would report a patch note as a critical break. Claims under these
 * headings are fixes unless they explicitly announce a breaking change.
 */
const MAINTENANCE_HEADING = /bug ?fix|^fixes|patch(es)?|chore|refactor|dependenc(y|ies)|documentation|docs|test(s|ing)?|revert/i;

/**
 * Deliberately not case-insensitive as a whole: the all-caps `BREAKING` marker is
 * a convention, whereas lowercase "breaking" is an ordinary English word that
 * appears in bug-fix titles ("fix a regression breaking the build").
 */
const EXPLICIT_BREAKING = /BREAKING[- ]CHANGE|\bBREAKING\b|(^|[\s(])\[[Bb]reaking\]|(^|[\s(])[Bb]reaking:|[Bb]reaking change|no longer supported|must (now )?(be )?(migrat|updat|chang)/;

/**
 * Keep a Changelog categories. When a claim sits directly under one of these, the
 * heading is what the author meant — more reliable than pattern-matching the
 * prose, which misreads "Added a clear() function so interceptors can be removed"
 * as an API removal.
 */
const CHANGELOG_HEADING: Array<[RegExp, KnowledgeType]> = [
  [/^\s*(breaking[- ]changes?|incompatible changes?)\s*$/i, 'breaking_change'],
  [/^\s*(added|new features?|features?)\s*$/i, 'new_api'],
  [/^\s*(deprecated|deprecations?)\s*$/i, 'deprecated_api'],
  [/^\s*(removed|removals?)\s*$/i, 'removed_api'],
  [/^\s*(security)\s*$/i, 'security_fix'],
  [/^\s*(fixed|bug fixes?)\s*$/i, 'bug_fix'],
  [/^\s*(changed|changes)\s*$/i, 'behavior_change'],
];

/** Conventional-commit prefixes are the most reliable signal in generated release notes. */
const CONVENTIONAL_PREFIX: Array<[RegExp, KnowledgeType]> = [
  [/^\s*(fix|perf|chore|refactor|test|docs|build|ci|style|revert)(\([^)]*\))?!?:/i, 'bug_fix'],
  [/^\s*feat(\([^)]*\))?:/i, 'new_api'],
];

/** `feat!:` / `fix(scope)!:` — the `!` marks a breaking change. */
const CONVENTIONAL_BREAKING = /^\s*\w+(\([^)]*\))?!:/;

/** Headings whose content is never a change claim. */
const EXCLUDED_HEADING = /contributor|acknowledg|thanks|sponsor|install(ation)?$|license|table of contents/i;

/**
 * Work on the project's own scaffolding rather than on the package.
 *
 * Generated release notes list every merged commit, so a release reads as
 * "Removed Webpack", "Update security.md", "Fix Gitpod dead link", "Using Logo
 * Axios in Readme.md". None of that can break a consumer, but each one becomes a
 * knowledge object, dilutes the index, and — for the "security" one — arrives
 * labelled HIGH. The claim is dropped unless it explicitly announces a breaking
 * change, which is the one case where housekeeping wording can hide a real one.
 */
const REPOSITORY_HOUSEKEEPING =
  /\b(readme|contributing|code[- ]of[- ]conduct|changelog|security)\.md\b|\b(readme|dependabot|gitpod|codeql|renovate|codecov|stale ?bot)\b|\bgithub actions?\b|\bworkflow file\b|\b(ci|build) (config|pipeline|matrix)\b|\bbadges?\b|\blogo\b|\bdead link\b|\bsyntax highlighting\b|\btypos?\b|\bcode block\b|\bissue template\b|\bpull request template\b|\bfunding\b/i;

const VERSION_IN_TEXT = /\bv?(\d+\.\d+(?:\.\d+)?(?:-[\w.]+)?)\b/;

/**
 * Classifies a claim in the context of its own heading. Order of authority:
 * an explicit breaking marker, the conventional-commit prefix, the Keep a
 * Changelog category, the enclosing maintenance section, then the prose patterns.
 */
function classify(text: string, heading: string, headingContext: string): KnowledgeType | null {
  const explicitlyBreaking = EXPLICIT_BREAKING.test(text) || CONVENTIONAL_BREAKING.test(text);
  if (explicitlyBreaking) return classifyProse(text) ?? 'breaking_change';

  // Substance outranks the heading. Projects list "Fixed prototype pollution in
  // formDataToJSON" under "Bug Fixes"; filing that as a bug fix understates how
  // urgently a consumer needs to upgrade.
  if (SECURITY_SUBSTANCE.test(text)) return 'security_fix';

  for (const [pattern, type] of CONVENTIONAL_PREFIX) {
    if (pattern.test(text)) return type;
  }

  for (const [pattern, type] of CHANGELOG_HEADING) {
    if (pattern.test(heading)) return type;
  }

  // A maintenance section demotes its contents; only an explicit marker escapes.
  // Security is already handled above, so anything left here is a fix.
  if (MAINTENANCE_HEADING.test(headingContext)) return 'bug_fix';

  return classifyProse(text);
}

/**
 * Exported so an index built under older rules can be pruned of entries this
 * would now reject, rather than requiring every package to be re-researched.
 */
export function isRepositoryHousekeeping(claim: string): boolean {
  return REPOSITORY_HOUSEKEEPING.test(claim) && !EXPLICIT_BREAKING.test(claim);
}

function classifyProse(text: string): KnowledgeType | null {
  for (const { type, pattern } of CLASSIFIERS) {
    if (pattern.test(text)) return type;
  }
  return null;
}

/** Markdown links and PR references are citation noise, not part of the claim. */
function stripMarkdownNoise(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s*\(?\[?#\d+\]?\)?\s*$/, '')
    .replace(/\s*by @[\w-]+( in .*)?$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Symbols the claim is about: backticked identifiers, then dotted call
 * expressions in bare prose. Backticks are far more reliable, so bare-prose
 * matches are only used when the claim has no code formatting at all.
 */
function extractSymbols(text: string): string[] {
  const symbols = new Set<string>();

  for (const match of text.matchAll(/`([^`]{1,80})`/g)) {
    const candidate = match[1].trim();
    if (/^[A-Za-z_$@][\w$.@/-]*(\(\))?$/.test(candidate)) symbols.add(candidate.replace(/\(\)$/, '()'));
  }

  if (symbols.size === 0) {
    for (const match of text.matchAll(/\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)\(?\)?/g)) {
      symbols.add(match[1]);
    }
  }

  return [...symbols].slice(0, 12);
}

const CONFIG_KEY = /\b([a-z][\w-]*(?:\.[a-z][\w-]*)+|[A-Z][A-Z0-9_]{3,})\b/g;

function extractConfigKeys(text: string, type: KnowledgeType): string[] {
  if (type !== 'configuration_change' && type !== 'environment_change') return [];
  return [...new Set([...text.matchAll(CONFIG_KEY)].map((match) => match[1]))].slice(0, 8);
}

/** `- old` / `+ new` diff blocks carry before/after in a single fence. */
function splitDiffBlock(block: CodeBlock): { before: string; after: string } | null {
  const lines = block.code.split('\n');
  const removed = lines.filter((line) => /^-(?!-)/.test(line)).map((line) => line.slice(1).trim());
  const added = lines.filter((line) => /^\+(?!\+)/.test(line)).map((line) => line.slice(1).trim());
  if (removed.length === 0 || added.length === 0) return null;
  return { before: removed.join('\n'), after: added.join('\n') };
}

function migrationFromSection(section: DocumentSection, description: string): MigrationStep[] {
  const steps: MigrationStep[] = [];

  for (const block of section.codeBlocks) {
    const diff = splitDiffBlock(block);
    if (diff) {
      steps.push({
        kind: 'replace',
        description: 'Apply the change shown in the source diff',
        before: diff.before,
        after: diff.after,
        language: block.language,
      });
    }
  }

  // Two consecutive fences in a change section conventionally mean before/after.
  if (steps.length === 0 && section.codeBlocks.length >= 2) {
    const [before, after] = section.codeBlocks;
    steps.push({
      kind: 'replace',
      description: 'Replace the previous form with the new form',
      before: before.code,
      after: after.code,
      language: after.language ?? before.language,
    });
  }

  if (steps.length === 0 && section.codeBlocks.length === 1) {
    const block = section.codeBlocks[0];
    const isShellInstall = /^(npm|yarn|pnpm|bun|pip|poetry)\s/m.test(block.code);
    steps.push({
      kind: isShellInstall ? 'install' : 'manual',
      description: isShellInstall ? 'Run the documented install/upgrade command' : description,
      after: block.code,
      language: block.language,
    });
  }

  return steps.slice(0, 4);
}

/** Splits a section's prose into individually classifiable claims. */
function claimsFrom(section: DocumentSection): string[] {
  if (section.bullets.length > 0) return section.bullets;

  return section.text
    .split(/\n{2,}|(?<=[.!?])\s+(?=[A-Z`])/)
    .map((claim) => claim.replace(/\s+/g, ' ').trim())
    .filter((claim) => claim.length >= 25 && claim.length <= 600);
}

function versionForSection(section: DocumentSection, context: ExtractionContext): string | undefined {
  for (const heading of [section.heading, ...[...section.headingTrail].reverse()]) {
    const match = VERSION_IN_TEXT.exec(heading);
    if (match) return match[1];
  }
  return context.documentVersion ?? context.toVersion;
}

function titleFor(claim: string, section: DocumentSection): string {
  const firstSentence = claim.split(/(?<=[.!?])\s/)[0].trim();
  const candidate = firstSentence.length > 12 ? firstSentence : section.heading || claim;
  return candidate.replace(/[`*]/g, '').slice(0, 120);
}

export function extractKnowledge(
  document: NormalizedDocument,
  context: ExtractionContext,
): KnowledgeObject[] {
  const results: KnowledgeObject[] = [];
  const now = new Date().toISOString();

  for (const section of document.sections) {
    const headingContext = [section.heading, ...section.headingTrail].join(' ');
    if (EXCLUDED_HEADING.test(headingContext)) continue;

    const isMaintenance = MAINTENANCE_HEADING.test(headingContext);
    /** A section that announces changes, so its type may be inferred from the heading. */
    const sectionIsRelevant = RELEVANT_HEADING.test(headingContext) && !isMaintenance;
    /**
     * Any section that is part of a changelog, including maintenance ones.
     *
     * Retention and classification are separate questions. A bullet under
     * "Bug Fixes" is definitionally a change record, so it is kept — demoted to
     * `bug_fix`, never promoted. Dropping it would discard the most reliably
     * labelled fixes in the document, which are exactly what answers "was this
     * fixed?" in error mode. Volume is controlled by `maxClaims`, not by silence.
     */
    const sectionIsChangeLog = sectionIsRelevant || isMaintenance;
    const sectionVersion = versionForSection(section, context);

    for (const rawClaim of claimsFrom(section)) {
      const claim = stripMarkdownNoise(rawClaim);
      if (claim.length < 12) continue;

      // Housekeeping is dropped before classification, so it cannot be promoted
      // by a pattern that happens to match its wording.
      if (isRepositoryHousekeeping(claim)) continue;

      const type =
        classify(claim, section.heading, headingContext) ??
        (sectionIsRelevant ? inferTypeFromHeading(headingContext) : null);
      if (!type) continue;

      // Outside a changelog section, require the claim itself to be unambiguous —
      // otherwise ordinary documentation prose produces noise.
      if (!sectionIsChangeLog && !isStrongClaim(claim, type)) continue;

      const symbols = extractSymbols(claim);
      const migration = migrationFromSection(section, claim);

      const source: SourceRef = {
        ...context.source,
        sectionAnchor: section.anchor,
        quotedText: claim.slice(0, 500),
        title: context.source.title ?? document.title,
      };

      const confidence = scoreConfidence({
        sourceTypes: [context.source.sourceType],
        independentDomains: 1,
        // The claim is version-anchored to a release inside the upgrade window —
        // it demonstrably applies to this upgrade, not merely to the package.
        exactVersionMatch: isInWindow(sectionVersion ?? '', context.fromVersion, context.toVersion),
        provenance: context.source.sourceType.startsWith('official') ? 'official' : 'community',
      });

      const fingerprint = knowledgeFingerprint(context.package, type, claim, symbols);

      results.push({
        id: `k_${shortHash(`${context.source.url}:${fingerprint}`, 20)}`,
        type,
        package: context.package,
        ecosystem: context.ecosystem,
        fromVersion: context.fromVersion,
        toVersion: context.toVersion,
        introduced: sectionVersion,
        affected: affectedRange(sectionVersion),
        title: titleFor(claim, section),
        description: claim,
        summary: claim.slice(0, 240),
        oldBehavior: migration[0]?.before,
        newBehavior: migration[0]?.after,
        affectedApis: symbols,
        affectedConfig: extractConfigKeys(claim, type),
        migration,
        severity: adjustSeverity(severityForType(type), type, symbols),
        provenance: source.sourceType.startsWith('official') ? 'official' : 'community',
        sources: [source],
        confidence: confidence.score,
        fingerprint,
        embedding: null,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  const limit = context.maxClaims ?? DEFAULT_MAX_CLAIMS;
  if (results.length <= limit) return results;

  return [...results].sort((a, b) => claimValue(a) - claimValue(b)).slice(0, limit);
}

const SEVERITY_LADDER: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

/**
 * A removal that names no symbol ("Removed unused imports", "Removed Webpack")
 * is almost always internal. It stays in the index — it is a real claim — but it
 * must not drive a CRITICAL rating that a caller would act on.
 */
function adjustSeverity(severity: Severity, type: KnowledgeType, symbols: string[]): Severity {
  const needsSymbol = type === 'removed_api' || type === 'renamed_api' || type === 'breaking_change';
  if (!needsSymbol || symbols.length > 0) return severity;

  const index = SEVERITY_LADDER.indexOf(severity);
  return SEVERITY_LADDER[Math.min(index + 1, SEVERITY_LADDER.length - 1)];
}

function inferTypeFromHeading(heading: string): KnowledgeType | null {
  if (/remov/i.test(heading)) return 'removed_api';
  if (/deprecat/i.test(heading)) return 'deprecated_api';
  if (/renam/i.test(heading)) return 'renamed_api';
  if (/breaking|incompatib/i.test(heading)) return 'breaking_change';
  if (/migrat|upgrad/i.test(heading)) return 'breaking_change';
  return null;
}

/**
 * Outside a change-focused section, a claim must name a symbol or state a hard
 * requirement to count. "Fixed a typo" should not become knowledge.
 */
function isStrongClaim(claim: string, type: KnowledgeType): boolean {
  if (type === 'bug_fix' || type === 'performance_change' || type === 'new_api') return false;
  return /`/.test(claim) || /\b(must|required|no longer|removed|renamed|deprecated)\b/i.test(claim);
}

/**
 * The deduplication key (gen.md section 12). Built from the package, the claim
 * type, and the symbols involved — so "foo() was removed" and "foo() has been
 * removed" collapse, while two different removed symbols stay distinct.
 */
export function knowledgeFingerprint(
  packageName: string,
  type: KnowledgeType,
  claim: string,
  symbols: string[],
): string {
  const symbolKey = symbols.length > 0 ? [...symbols].sort().join(',') : normalizeForHash(claim).slice(0, 80);
  return shortHash(`${packageName.toLowerCase()}|${type}|${symbolKey}`, 20);
}

/**
 * Seam for an optional LLM pass (gen.md section 16). Any implementation must
 * preserve `sources` and `fingerprint` and may only improve `title`, `summary`,
 * and `migration[].description` — never add claims. Unimplemented in Phase 1.
 */
export async function refineWithModel(knowledge: KnowledgeObject[]): Promise<KnowledgeObject[]> {
  return knowledge;
}
