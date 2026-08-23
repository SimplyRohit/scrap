'use node';

/**
 * The agent protocol (gen.md sections 16, 19, 20).
 *
 * `resolve` is the read half — what a set of package changes will break and what
 * a set of observed errors means, in one call. `report` is the write half: an
 * agent that applied a fix and ran the repository's checks tells us whether it
 * worked, and the index moves accordingly.
 *
 * Repository correlation is not available here. Answering "which of *your* files
 * break" means reading the caller's working tree, which a hosted backend cannot
 * do — the CLI (`upgrade-intel repo`) and the local Next.js route still do it,
 * and the instructions below say so rather than quietly returning less.
 */

import { ConvexError, v } from 'convex/values';

import { action } from './_generated/server';
import { withEngine } from './model/engine';
import { resolveError, type ErrorResolution } from '../lib/engine/errorPipeline';
import { recordFixOutcome } from '../lib/engine/feedback';
import { detectEcosystem } from '../lib/engine/ingestion/manifest';
import type { KnowledgeObject } from '../lib/engine/knowledge';
import { renderMigrationPlan } from '../lib/engine/output/markdown';
import { researchPackageUpgrade, type PackageResearchResult } from '../lib/engine/pipeline';
import {
  checkOutcome,
  ecosystem,
  knowledgeObject,
  migrationStep,
  riskAssessment,
  riskLevel,
  versionChange,
} from './validators';

const INSTRUCTIONS = [
  'Inspect the repository before changing anything.',
  'Only apply steps whose evidence is version-matched and officially sourced.',
  'Treat any finding carrying a `caveat` as a hypothesis to verify, not a fix to apply.',
  'Run tests, typecheck, and build after applying changes.',
  'Resubmit any remaining error to errors.analyze rather than guessing.',
  'Repository correlation is local: run `upgrade-intel repo` on the working tree to find out which files these changes touch.',
];

export const resolve = action({
  args: {
    packageChanges: v.optional(
      v.array(
        v.object({
          package: v.string(),
          from: v.string(),
          to: v.optional(v.string()),
          ecosystem: v.optional(ecosystem),
        }),
      ),
    ),
    errors: v.optional(
      v.array(
        v.object({
          package: v.string(),
          error: v.string(),
          version: v.optional(v.string()),
          previousVersion: v.optional(v.string()),
          stackTrace: v.optional(v.string()),
          ecosystem: v.optional(ecosystem),
        }),
      ),
    ),
    refresh: v.optional(v.boolean()),
    maxDocuments: v.optional(v.number()),
    includeMarkdown: v.optional(v.boolean()),
  },
  returns: v.object({
    packageChanges: v.array(
      v.object({
        package: v.string(),
        change: versionChange,
        risk: riskAssessment,
        breakingChanges: v.number(),
      }),
    ),
    errors: v.array(
      v.object({
        fingerprint: v.string(),
        errorType: v.string(),
        diagnosis: v.string(),
        likelyCause: v.union(v.null(), v.string()),
        fix: v.array(migrationStep),
        affectedVersions: v.array(v.string()),
        fixedVersions: v.array(v.string()),
        confidence: v.number(),
        caveat: v.union(v.null(), v.string()),
        repositoryImpact: v.array(v.string()),
      }),
    ),
    relevantKnowledge: v.array(knowledgeObject),
    migrationPlan: v.array(
      v.object({
        package: v.string(),
        risk: riskLevel,
        steps: v.array(migrationStep),
        markdown: v.optional(v.string()),
      }),
    ),
    evidence: v.array(
      v.object({
        knowledgeId: v.string(),
        url: v.string(),
        sourceType: v.string(),
        quotedText: v.optional(v.string()),
        confidence: v.number(),
      }),
    ),
    instructions: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const packageChanges = args.packageChanges ?? [];
    const errors = args.errors ?? [];

    if (packageChanges.length === 0 && errors.length === 0) {
      throw new ConvexError('Provide `packageChanges` and/or `errors`.');
    }

    const upgrades: PackageResearchResult[] = [];
    const resolutions: ErrorResolution[] = [];

    await withEngine(ctx, async (store) => {
      for (const change of packageChanges) {
        upgrades.push(
          await researchPackageUpgrade(
            {
              name: change.package,
              ecosystem: change.ecosystem ?? detectEcosystem(change.package, 'nodejs'),
              currentVersion: change.from,
              targetVersion: change.to,
              dependencyType: 'dependencies',
              specifier: change.from,
            },
            { store, refresh: args.refresh, maxDocuments: args.maxDocuments, targetVersion: change.to },
          ),
        );
      }

      for (const item of errors) {
        resolutions.push(
          await resolveError({
            store,
            package: item.package,
            version: item.version,
            previousVersion: item.previousVersion,
            error: item.error,
            stackTrace: item.stackTrace,
            ecosystem: item.ecosystem,
            refresh: args.refresh,
            maxDocuments: args.maxDocuments,
          }),
        );
      }
    });

    const relevantKnowledge: KnowledgeObject[] = upgrades.flatMap((result) => result.knowledge);

    return {
      packageChanges: upgrades.map((result) => ({
        package: result.package,
        change: result.change,
        risk: result.risk,
        breakingChanges: result.knowledge.length,
      })),
      errors: resolutions.map((resolution) => ({
        fingerprint: resolution.fingerprint.fingerprint,
        errorType: resolution.fingerprint.errorType,
        diagnosis: resolution.diagnosis,
        likelyCause: resolution.likelyCause,
        fix: resolution.fix,
        affectedVersions: resolution.affectedVersions,
        fixedVersions: resolution.fixedVersions,
        confidence: resolution.confidence,
        caveat: resolution.caveat,
        repositoryImpact: resolution.repositoryImpact,
      })),
      relevantKnowledge,
      migrationPlan: upgrades.map((result) => ({
        package: result.package,
        risk: result.risk.level,
        steps: result.knowledge.flatMap((item) => item.migration),
        markdown: args.includeMarkdown ? renderMigrationPlan(result) : undefined,
      })),
      evidence: [
        ...relevantKnowledge.flatMap((item) =>
          item.sources.map((source) => ({
            knowledgeId: item.id,
            url: source.url,
            sourceType: source.sourceType,
            quotedText: source.quotedText,
            confidence: item.confidence,
          })),
        ),
        ...resolutions.flatMap((resolution) =>
          resolution.evidence.map((item) => ({
            knowledgeId: item.knowledgeId,
            url: item.url,
            sourceType: item.sourceType,
            quotedText: item.quotedText,
            confidence: item.confidence,
          })),
        ),
      ],
      instructions: INSTRUCTIONS,
    };
  },
});

/**
 * The write-back half of the loop.
 *
 * Reporting a failure is as useful as reporting a success, so this accepts both
 * and never treats a failed report as an error. What it will not accept is a fix
 * with no validation result: that is a claim, not evidence.
 */
export const report = action({
  args: {
    package: v.string(),
    summary: v.string(),
    validation: v.object({
      tests: v.optional(checkOutcome),
      typecheck: v.optional(checkOutcome),
      build: v.optional(checkOutcome),
      notes: v.optional(v.string()),
    }),
    fix: v.optional(v.array(migrationStep)),
    ecosystem: v.optional(ecosystem),
    version: v.optional(v.string()),
    previousVersion: v.optional(v.string()),
    error: v.optional(v.string()),
    stackTrace: v.optional(v.string()),
    derivedFrom: v.optional(v.array(v.string())),
    repository: v.optional(v.string()),
  },
  returns: v.object({
    recorded: v.union(v.null(), knowledgeObject),
    succeeded: v.boolean(),
    reinforced: v.array(v.object({ id: v.string(), before: v.number(), after: v.number() })),
    message: v.string(),
  }),
  handler: async (ctx, args) => {
    if (!args.package.trim()) throw new ConvexError('Missing `package`.');
    if (!args.summary.trim()) throw new ConvexError('Missing `summary`.');
    if (Object.values(args.validation).every((value) => value === undefined)) {
      throw new ConvexError('Missing `validation` — a fix without a validation result is not evidence.');
    }

    return withEngine(ctx, (store) =>
      recordFixOutcome({
        store,
        package: args.package,
        ecosystem: args.ecosystem,
        version: args.version,
        previousVersion: args.previousVersion,
        error: args.error,
        stackTrace: args.stackTrace,
        fix: args.fix ?? [],
        summary: args.summary,
        derivedFrom: args.derivedFrom,
        validation: args.validation,
        repository: args.repository,
      }),
    );
  },
});
