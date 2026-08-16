#!/usr/bin/env bun
/**
 * upgrade-intel — the CLI from gen.md section 25.
 *
 * Calls the engine directly rather than the HTTP API, so it works with no server
 * running. Every command supports `--json` because the primary consumer is a
 * coding agent (section 19), and `--fail-on` so it can gate CI.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { boolFlag, numberFlag, parseArgs, stringFlag, type ParsedArgs } from './args';
import {
  bold,
  bullet,
  confidenceLabel,
  cyan,
  dim,
  green,
  heading,
  percent,
  red,
  riskColor,
  severityColor,
  table,
  yellow,
} from './format';

import { applicableKnowledge, correlateRepository } from '../lib/engine/analysis/repository';
import { isBreaking, type RiskLevel } from '../lib/engine/analysis/versionDiff';
import { recordFixOutcome } from '../lib/engine/feedback';
import { getStore } from '../lib/engine/index/store';
import { applyLockfileVersions, detectEcosystem, parseManifest } from '../lib/engine/ingestion/manifest';
import { resolveError } from '../lib/engine/errorPipeline';
import type { Ecosystem, KnowledgeObject } from '../lib/engine/knowledge';
import {
  renderDocuments,
  renderErrorAnalysis,
  renderMigrationPlan,
  renderRepositoryImpactDocument,
} from '../lib/engine/output/markdown';
import { researchManifest, researchPackageUpgrade, type PackageResearchResult } from '../lib/engine/pipeline';
import { brightDataConfigured } from '../lib/engine/research/fetcher';
import { tryFetchPackageMetadata } from '../lib/engine/research/registry';
import { planUpgradeSources } from '../lib/engine/research/sources';
import { serpConfigured } from '../lib/engine/research/search';

const USAGE = `
${bold('upgrade-intel')} — package migration and error intelligence

${bold('Usage')}
  upgrade-intel <command> [options]

${bold('Commands')}
  package <name> --from <version>          Research the latest upgrade for a package
  migrate <name> --from <v> --to <v>       Research a specific version window
  error --package <p> --error <text>       Diagnose an error against the index
  repo [path]                              Analyse a repository's manifest end to end
  search <query>                           Search the knowledge index (never scrapes)
  index <name> --from <version>            Index a package on demand
  sources <name>                           Show the sources that would be researched
  report --package <p> --summary <s>       Record a fix outcome (validation feedback)
  stats                                    Index statistics and engine capabilities

${bold('Common options')}
  --json                 Machine-readable output
  --refresh              Bypass the cache and index coverage
  --max-documents <n>    Cap documents fetched per package (default 6)
  --markdown             Print the generated Markdown instead of a summary
  --fail-on <level>      Exit 2 if risk reaches this level (LOW|MEDIUM|HIGH|CRITICAL)

${bold('Examples')}
  upgrade-intel migrate prisma --from 5.22.0 --to 6.0.0
  upgrade-intel error --package prisma --version 6.0.0 --error "PrismaClientInitializationError: ..."
  upgrade-intel repo . --fail-on HIGH --json
`;

const RISK_ORDER: RiskLevel[] = ['SAFE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

function meetsThreshold(level: RiskLevel, threshold: string): boolean {
  const index = RISK_ORDER.indexOf(level);
  const limit = RISK_ORDER.indexOf(threshold.toUpperCase() as RiskLevel);
  return limit >= 0 && index >= limit;
}

function fail(message: string): never {
  process.stderr.write(`${red('error')} ${message}\n`);
  process.exit(1);
}

function emitJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function researchOptions(args: ParsedArgs) {
  return {
    refresh: boolFlag(args.flags, 'refresh'),
    maxDocuments: numberFlag(args.flags, 'max-documents', 'maxDocuments'),
  };
}

function printKnowledge(knowledge: KnowledgeObject[], limit = 20): void {
  const breaking = knowledge.filter(isBreaking).sort((a, b) => b.confidence - a.confidence);
  const rest = knowledge.filter((item) => !isBreaking(item));

  if (breaking.length === 0) {
    process.stdout.write(dim('  No breaking changes were extracted from the sources read.\n'));
  }

  for (const item of breaking.slice(0, limit)) {
    const colour = severityColor(item.severity);
    process.stdout.write(
      `  ${colour(item.severity.padEnd(8))} ${item.title}\n` +
        `           ${dim(`${item.type} · ${confidenceLabel(item.confidence)} confidence · ${item.sources[0]?.sourceType ?? 'unsourced'}`)}\n`,
    );

    if (item.affectedApis.length > 0) {
      process.stdout.write(`           ${dim('symbols:')} ${item.affectedApis.slice(0, 6).join(', ')}\n`);
    }
    const quote = item.sources[0]?.quotedText;
    if (quote) process.stdout.write(`           ${dim(`"${quote.slice(0, 110)}"`)}\n`);
  }

  if (breaking.length > limit) {
    process.stdout.write(dim(`  … and ${breaking.length - limit} more breaking changes\n`));
  }
  if (rest.length > 0) {
    process.stdout.write(dim(`  (${rest.length} other change records indexed)\n`));
  }
}

function printResearchResult(result: PackageResearchResult, args: ParsedArgs): void {
  const { change, risk } = result;

  process.stdout.write(heading(`${result.package}  ${change.fromVersion} → ${change.toVersion ?? 'unresolved'}`));
  process.stdout.write(`\n  ${dim('delta')}   ${change.delta}\n`);
  process.stdout.write(`  ${dim('risk')}    ${riskColor(risk.level)(risk.level)} ${dim(`(${risk.score}/100)`)}\n`);

  for (const reason of risk.rationale) process.stdout.write(bullet(dim(reason), 2) + '\n');

  process.stdout.write(heading('Findings'));
  process.stdout.write('\n');
  printKnowledge(result.knowledge);

  process.stdout.write(heading('Sources'));
  process.stdout.write('\n');
  if (result.trace.servedFromIndex) {
    process.stdout.write(dim('  Served from the knowledge index — no fetching required.\n'));
  }
  for (const source of result.trace.fetched) {
    const yield_ = source.extracted > 0 ? green(`${source.extracted} claims`) : dim('no claims');
    process.stdout.write(`  ${yield_}  ${dim(source.sourceType)}  ${source.url}\n`);
  }
  for (const failure of result.trace.failures) {
    process.stdout.write(`  ${yellow('failed')}  ${dim(failure.reason.slice(0, 90))}\n`);
  }

  for (const warning of result.warnings) {
    process.stdout.write(`\n${yellow('warning')} ${warning}\n`);
  }

  if (boolFlag(args.flags, 'markdown')) {
    process.stdout.write(`\n${renderMigrationPlan(result)}\n`);
  }
}

async function commandPackage(args: ParsedArgs): Promise<number> {
  const name = args.positional[0];
  if (!name) fail('usage: upgrade-intel package <name> --from <version>');

  const from = stringFlag(args.flags, 'from', 'current');
  if (!from) fail('`--from <version>` is required — the engine will not guess your current version');

  const result = await researchPackageUpgrade(
    {
      name,
      ecosystem: (stringFlag(args.flags, 'ecosystem') as Ecosystem) ?? detectEcosystem(name, 'nodejs'),
      currentVersion: from,
      dependencyType: 'dependencies',
      specifier: from,
    },
    { ...researchOptions(args), targetVersion: stringFlag(args.flags, 'to') },
  );

  if (boolFlag(args.flags, 'json')) {
    emitJson(result);
  } else {
    printResearchResult(result, args);
  }

  const threshold = stringFlag(args.flags, 'fail-on');
  return threshold && meetsThreshold(result.risk.level, threshold) ? 2 : 0;
}

async function commandError(args: ParsedArgs): Promise<number> {
  const packageName = stringFlag(args.flags, 'package', 'p');
  const error = stringFlag(args.flags, 'error', 'e');

  if (!packageName) fail('`--package <name>` is required');
  if (!error) fail('`--error <text>` is required');

  const resolution = await resolveError({
    package: packageName,
    version: stringFlag(args.flags, 'version', 'v'),
    previousVersion: stringFlag(args.flags, 'previous-version'),
    error,
    stackTrace: stringFlag(args.flags, 'stack', 'stack-trace'),
    indexOnly: boolFlag(args.flags, 'index-only', 'offline'),
    ...researchOptions(args),
  });

  if (boolFlag(args.flags, 'json')) {
    emitJson(resolution);
    return 0;
  }

  if (boolFlag(args.flags, 'markdown')) {
    process.stdout.write(`${renderErrorAnalysis(resolution)}\n`);
    return 0;
  }

  process.stdout.write(heading('Diagnosis'));
  process.stdout.write(`\n  ${resolution.diagnosis}\n`);
  process.stdout.write(
    `  ${dim('fingerprint')} ${resolution.fingerprint.fingerprint} ${dim(`(${resolution.fingerprint.errorType})`)}\n`,
  );
  process.stdout.write(
    `  ${dim('confidence')}  ${confidenceLabel(resolution.confidence)} ${dim(`(${resolution.confidenceCategory})`)}\n`,
  );

  if (resolution.caveat) process.stdout.write(`\n  ${yellow(resolution.caveat)}\n`);

  if (resolution.fixedVersions.length > 0) {
    process.stdout.write(`\n  ${green('fixed in')} ${resolution.fixedVersions.join(', ')}\n`);
  }

  if (resolution.fix.length > 0) {
    process.stdout.write(heading('Suggested fix'));
    process.stdout.write('\n');
    for (const step of resolution.fix) {
      process.stdout.write(bullet(step.description) + '\n');
      if (step.before) process.stdout.write(`      ${red('-')} ${step.before.split('\n')[0]}\n`);
      if (step.after) process.stdout.write(`      ${green('+')} ${step.after.split('\n')[0]}\n`);
    }
  }

  process.stdout.write(heading('Evidence'));
  process.stdout.write('\n');
  if (resolution.evidence.length === 0) {
    process.stdout.write(dim('  Nothing in the index matches this error.\n'));
  }
  for (const item of resolution.evidence.slice(0, 6)) {
    process.stdout.write(`  ${confidenceLabel(item.confidence)}  ${item.title.slice(0, 90)}\n`);
    process.stdout.write(`         ${dim(`${item.sourceType} · ${item.url}`)}\n`);
  }

  return 0;
}

async function commandRepo(args: ParsedArgs): Promise<number> {
  const root = path.resolve(args.positional[0] ?? '.');

  const manifests = ['package.json', 'requirements.txt', 'pyproject.toml'];
  let manifest: { name: string; content: string } | null = null;

  for (const name of manifests) {
    try {
      manifest = { name, content: await readFile(path.join(root, name), 'utf8') };
      break;
    } catch {
      continue;
    }
  }
  if (!manifest) fail(`no manifest found in ${root} (looked for ${manifests.join(', ')})`);

  const parsed = parseManifest(manifest.content, manifest.name);

  for (const lockName of ['bun.lock', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml']) {
    try {
      const lock = await readFile(path.join(root, lockName), 'utf8');
      parsed.packages = applyLockfileVersions(parsed.packages, lock).packages;
      break;
    } catch {
      continue;
    }
  }

  const only = stringFlag(args.flags, 'packages');
  const research = await researchManifest(parsed, {
    ...researchOptions(args),
    packages: only ? only.split(',').map((name) => name.trim()) : undefined,
  });

  const impacts: Record<string, Awaited<ReturnType<typeof correlateRepository>>> = {};
  if (!boolFlag(args.flags, 'no-correlate')) {
    for (const result of research.results) {
      impacts[result.package] = await correlateRepository(root, result.package, result.knowledge);
    }
  }

  if (boolFlag(args.flags, 'json')) {
    emitJson({ ...research, impacts });
    return exitForManifest(research.results, args);
  }

  if (boolFlag(args.flags, 'markdown')) {
    const documents = renderDocuments(research, impacts);
    process.stdout.write(`${documents['analysis.md']}\n\n${documents['migration.md']}\n`);

    for (const result of research.results) {
      const impact = impacts[result.package];
      if (impact) process.stdout.write(`\n---\n\n${renderRepositoryImpactDocument(impact, result.knowledge)}\n`);
    }
    return exitForManifest(research.results, args);
  }

  process.stdout.write(heading(`${manifest.name} — ${research.results.length} packages`));
  process.stdout.write(`\n  ${dim('overall')} ${riskColor(research.overallSafety)(research.overallSafety)}\n\n`);

  const rows: string[][] = [[dim('PACKAGE'), dim('FROM'), dim('TO'), dim('RISK'), dim('BREAKING'), dim('USED IN')]];

  for (const result of [...research.results].sort((a, b) => b.risk.score - a.risk.score)) {
    const impact = impacts[result.package];
    const breaking = result.knowledge.filter(isBreaking);
    const applicable = impact ? applicableKnowledge(breaking, impact).length : breaking.length;

    rows.push([
      cyan(result.package),
      result.change.fromVersion,
      result.change.toVersion ?? dim('—'),
      riskColor(result.risk.level)(result.risk.level),
      `${applicable}${applicable !== breaking.length ? dim(`/${breaking.length}`) : ''}`,
      impact ? (impact.usesPackage ? `${impact.affectedFiles.length} files` : dim('unused')) : dim('n/a'),
    ]);
  }

  process.stdout.write(`${table(rows)}\n`);

  if (research.warnings.length > 0) {
    process.stdout.write(heading('Warnings'));
    process.stdout.write('\n');
    for (const warning of research.warnings.slice(0, 12)) {
      process.stdout.write(bullet(yellow(warning)) + '\n');
    }
  }

  return exitForManifest(research.results, args);
}

function exitForManifest(results: PackageResearchResult[], args: ParsedArgs): number {
  const threshold = stringFlag(args.flags, 'fail-on');
  if (!threshold) return 0;
  return results.some((result) => meetsThreshold(result.risk.level, threshold)) ? 2 : 0;
}

async function commandSearch(args: ParsedArgs): Promise<number> {
  const query = args.positional.join(' ');
  const packageName = stringFlag(args.flags, 'package', 'p');

  if (!query && !packageName) fail('usage: upgrade-intel search <query> [--package <name>]');

  const results = await getStore().search({
    text: query || undefined,
    package: packageName,
    version: stringFlag(args.flags, 'version', 'v'),
    limit: numberFlag(args.flags, 'limit') ?? 10,
  });

  if (boolFlag(args.flags, 'json')) {
    emitJson({ results, confidence: results[0]?.knowledge.confidence ?? 0 });
    return 0;
  }

  if (results.length === 0) {
    process.stdout.write(dim('No matching knowledge. Run `upgrade-intel index <name> --from <version>` first.\n'));
    return 0;
  }

  for (const { knowledge, score } of results) {
    process.stdout.write(
      `\n${severityColor(knowledge.severity)(knowledge.severity.padEnd(8))} ${knowledge.title.slice(0, 90)}\n`,
    );
    process.stdout.write(
      `         ${dim(`${knowledge.package} · ${knowledge.type} · ${confidenceLabel(knowledge.confidence)} · score ${score.toFixed(3)}`)}\n`,
    );
    if (knowledge.affected) process.stdout.write(`         ${dim(`affects ${knowledge.affected}`)}\n`);
    if (knowledge.sources[0]) process.stdout.write(`         ${dim(knowledge.sources[0].url)}\n`);
  }
  process.stdout.write('\n');

  return 0;
}

async function commandIndex(args: ParsedArgs): Promise<number> {
  const name = args.positional[0];
  const from = stringFlag(args.flags, 'from');

  if (!name) fail('usage: upgrade-intel index <name> --from <version>');
  if (!from) fail('`--from <version>` is required — indexing needs a window to research');

  const result = await researchPackageUpgrade(
    {
      name,
      ecosystem: (stringFlag(args.flags, 'ecosystem') as Ecosystem) ?? detectEcosystem(name, 'nodejs'),
      currentVersion: from,
      dependencyType: 'dependencies',
      specifier: from,
    },
    { ...researchOptions(args), targetVersion: stringFlag(args.flags, 'to') },
  );

  const stats = await getStore().stats();

  if (boolFlag(args.flags, 'json')) {
    emitJson({ package: name, indexed: result.knowledge.length, trace: result.trace, stats });
    return 0;
  }

  process.stdout.write(
    `${green('indexed')} ${result.knowledge.length} knowledge objects for ${cyan(name)} ` +
      `${dim(`(index now holds ${stats.total} across ${stats.packages} packages)`)}\n`,
  );
  return 0;
}

async function commandSources(args: ParsedArgs): Promise<number> {
  const name = args.positional[0];
  if (!name) fail('usage: upgrade-intel sources <name>');

  const ecosystem = (stringFlag(args.flags, 'ecosystem') as Ecosystem) ?? detectEcosystem(name, 'nodejs');
  const metadata = await tryFetchPackageMetadata(name, ecosystem);
  if (!metadata) fail(`registry lookup failed for ${name}`);

  const target = stringFlag(args.flags, 'to') ?? metadata.latestVersion ?? 'latest';
  const plan = planUpgradeSources(metadata, target);

  if (boolFlag(args.flags, 'json')) {
    emitJson({ metadata, plan });
    return 0;
  }

  process.stdout.write(heading(`${name} — source plan for ${target}`));
  process.stdout.write(`\n  ${dim('repository')}   ${metadata.repositoryUrl ?? dim('unknown')}\n`);
  process.stdout.write(`  ${dim('docs')}         ${metadata.documentationUrl ?? metadata.homepage ?? dim('unknown')}\n\n`);

  for (const candidate of plan) {
    const marker = candidate.speculative ? dim('guess ') : green('known ');
    process.stdout.write(`  ${marker} ${dim(candidate.sourceType.padEnd(26))} ${candidate.url}\n`);
  }
  return 0;
}

async function commandReport(args: ParsedArgs): Promise<number> {
  const packageName = stringFlag(args.flags, 'package', 'p');
  const summary = stringFlag(args.flags, 'summary');

  if (!packageName) fail('`--package <name>` is required');
  if (!summary) fail('`--summary <text>` is required — describe what was changed');

  const validation = {
    tests: stringFlag(args.flags, 'tests') as 'passed' | 'failed' | 'skipped' | undefined,
    typecheck: stringFlag(args.flags, 'typecheck') as 'passed' | 'failed' | 'skipped' | undefined,
    build: stringFlag(args.flags, 'build') as 'passed' | 'failed' | 'skipped' | undefined,
  };

  if (!validation.tests && !validation.typecheck && !validation.build) {
    fail('at least one of --tests/--typecheck/--build is required — a fix without validation is not evidence');
  }

  const derived = stringFlag(args.flags, 'derived-from');

  const result = await recordFixOutcome({
    package: packageName,
    version: stringFlag(args.flags, 'version', 'v'),
    error: stringFlag(args.flags, 'error', 'e'),
    summary,
    fix: [],
    derivedFrom: derived ? derived.split(',').map((id) => id.trim()) : undefined,
    validation,
    repository: stringFlag(args.flags, 'repository') ?? process.cwd(),
  });

  if (boolFlag(args.flags, 'json')) {
    emitJson(result);
    return 0;
  }

  process.stdout.write(`${result.succeeded ? green('recorded') : yellow('recorded')} ${result.message}\n`);
  for (const item of result.reinforced) {
    process.stdout.write(
      `  ${dim(item.id)} confidence ${percent(item.before)} → ${percent(item.after)}\n`,
    );
  }
  return 0;
}

async function commandStats(args: ParsedArgs): Promise<number> {
  const stats = await getStore().stats();
  const capabilities = {
    brightData: brightDataConfigured(),
    brightDataSerp: serpConfigured(),
    github: Boolean(process.env.GITHUB_TOKEN),
  };

  if (boolFlag(args.flags, 'json')) {
    emitJson({ ...stats, capabilities });
    return 0;
  }

  process.stdout.write(heading('Knowledge index'));
  process.stdout.write(`\n  ${dim('objects')}   ${stats.total}\n  ${dim('packages')}  ${stats.packages}\n`);
  process.stdout.write(`  ${dim('updated')}   ${stats.lastUpdated ?? 'never'}\n`);

  if (Object.keys(stats.byType).length > 0) {
    process.stdout.write(heading('By type'));
    process.stdout.write('\n');
    for (const [type, count] of Object.entries(stats.byType).sort((a, b) => b[1] - a[1])) {
      process.stdout.write(`  ${String(count).padStart(5)}  ${dim(type)}\n`);
    }
  }

  process.stdout.write(heading('Capabilities'));
  process.stdout.write('\n');
  for (const [name, active] of Object.entries(capabilities)) {
    process.stdout.write(`  ${active ? green('on ') : dim('off')}  ${name}\n`);
  }
  // Retrieval quality depends on this, so it is worth stating plainly.
  process.stdout.write(`  ${dim('off')}  embeddings ${dim('(retrieval is lexical only)')}\n`);

  return 0;
}

const COMMANDS: Record<string, (args: ParsedArgs) => Promise<number>> = {
  package: commandPackage,
  migrate: commandPackage,
  error: commandError,
  repo: commandRepo,
  search: commandSearch,
  index: commandIndex,
  sources: commandSources,
  report: commandReport,
  stats: commandStats,
};

export async function run(argv: string[]): Promise<number> {
  const args = parseArgs(argv);

  if (!args.command || boolFlag(args.flags, 'help', 'h')) {
    process.stdout.write(`${USAGE}\n`);
    return args.command ? 0 : 1;
  }

  const handler = COMMANDS[args.command];
  if (!handler) {
    process.stderr.write(`${red('error')} unknown command "${args.command}"\n${USAGE}\n`);
    return 1;
  }

  return handler(args);
}

// `import.meta.main` is true only when executed directly, so the module stays
// importable from tests without running the CLI.
if (import.meta.main) {
  run(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      process.stderr.write(`${red('error')} ${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
