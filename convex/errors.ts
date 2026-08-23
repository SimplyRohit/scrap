'use node';

/**
 * Error resolution (gen.md sections 7, 8, 19, 26).
 *
 * The index is consulted first and research runs only when what we already know
 * is insufficient, which is what makes the second occurrence of an error cheap.
 */

import { ConvexError, v } from 'convex/values';

import { action } from './_generated/server';
import { withEngine } from './model/engine';
import { resolveError } from '../lib/engine/errorPipeline';
import { renderErrorAnalysis } from '../lib/engine/output/markdown';
import { ecosystem, errorResolution } from './validators';

const analyzeArgs = {
  package: v.string(),
  error: v.string(),
  version: v.optional(v.string()),
  previousVersion: v.optional(v.string()),
  stackTrace: v.optional(v.string()),
  ecosystem: v.optional(ecosystem),
  environment: v.optional(v.record(v.string(), v.string())),
  repository: v.optional(v.string()),
  /** Answer from the index alone — never scrape. */
  indexOnly: v.optional(v.boolean()),
  refresh: v.optional(v.boolean()),
  maxDocuments: v.optional(v.number()),
};

export const analyze = action({
  args: { ...analyzeArgs, includeMarkdown: v.optional(v.boolean()) },
  returns: v.object({
    ...errorResolution.fields,
    documents: v.optional(v.record(v.string(), v.string())),
  }),
  handler: async (ctx, args) => {
    if (!args.package.trim()) throw new ConvexError('Missing `package`.');
    if (!args.error.trim()) throw new ConvexError('Missing `error`.');

    const resolution = await withEngine(ctx, (store) =>
      resolveError({
        store,
        package: args.package,
        version: args.version,
        previousVersion: args.previousVersion,
        error: args.error,
        stackTrace: args.stackTrace,
        ecosystem: args.ecosystem,
        environment: args.environment,
        repository: args.repository,
        indexOnly: args.indexOnly,
        refresh: args.refresh,
        maxDocuments: args.maxDocuments,
      }),
    );

    return {
      ...resolution,
      documents: args.includeMarkdown ? { 'error-analysis.md': renderErrorAnalysis(resolution) } : undefined,
    };
  },
});
