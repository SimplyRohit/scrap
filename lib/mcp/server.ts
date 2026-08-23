/**
 * MCP server (gen.md section 18).
 *
 * Section 18 asks for "an MCP server or CLI if practical". The CLI already
 * satisfies it, so this adds a transport, not a capability: every tool here
 * calls the same engine function the CLI command calls. Nothing is duplicated,
 * and nothing new is possible through this door.
 *
 * The protocol is JSON-RPC 2.0 over newline-delimited stdio. It is implemented
 * directly rather than through the SDK — the surface an agent actually uses is
 * `initialize`, `tools/list`, and `tools/call`, and a dependency for three
 * methods would cost more than it saves. `handleMessage` is pure, so the
 * protocol is testable without a client.
 */

import { writeStdout } from '../stdout';
import { applicableKnowledge, correlateRepository } from '../engine/analysis/repository';
import { initializeEngine } from '../engine/bootstrap';
import { resolveError } from '../engine/errorPipeline';
import { recordFixOutcome } from '../engine/feedback';
import { buildKnowledgeGraph, subgraph } from '../engine/index/graph';
import { embedQuery } from '../engine/index/embeddings';
import { getStore } from '../engine/index/store';
import { detectEcosystem } from '../engine/ingestion/manifest';
import type { Ecosystem } from '../engine/knowledge';
import { renderKnowledgeGraph } from '../engine/output/markdown';
import { researchPackageUpgrade } from '../engine/pipeline';

export const PROTOCOL_VERSION = '2025-06-18';
export const SERVER_INFO = { name: 'upgrade-intel', version: '0.1.0' };

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run(args: Record<string, unknown>): Promise<unknown>;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`\`${key}\` is required`);
  return value;
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

const ECOSYSTEMS: Ecosystem[] = ['nodejs', 'python', 'langchain', 'llamaindex', 'aiml'];

function ecosystemOf(args: Record<string, unknown>, packageName: string): Ecosystem {
  const given = optionalString(args, 'ecosystem');
  return ECOSYSTEMS.includes(given as Ecosystem) ? (given as Ecosystem) : detectEcosystem(packageName, 'nodejs');
}

export const TOOLS: ToolDefinition[] = [
  {
    name: 'search_knowledge',
    description:
      'Search the indexed knowledge about package changes and errors. Never scrapes — answers only from what is already indexed, so an empty result means "not indexed yet", not "no such change".',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free text, e.g. an error message' },
        package: { type: 'string' },
        version: { type: 'string', description: 'Filters to knowledge that applies to this version' },
        limit: { type: 'number' },
      },
    },
    async run(args) {
      const query = optionalString(args, 'query');
      const packageName = optionalString(args, 'package');
      if (!query && !packageName) throw new Error('Provide `query` or `package`');

      const results = await getStore().search({
        text: query,
        package: packageName,
        version: optionalString(args, 'version'),
        limit: typeof args.limit === 'number' ? args.limit : 10,
        embedding: query ? await embedQuery(query) : null,
      });

      return {
        retrieval: results.some((item) => item.signals.semantic > 0) ? 'hybrid' : 'lexical',
        results: results.map(({ knowledge, score }) => ({
          id: knowledge.id,
          type: knowledge.type,
          title: knowledge.title,
          severity: knowledge.severity,
          affected: knowledge.affected,
          affectedApis: knowledge.affectedApis,
          confidence: knowledge.confidence,
          sources: knowledge.sources.map((source) => source.url),
          score,
        })),
      };
    },
  },
  {
    name: 'analyze_error',
    description:
      'Diagnose an error against a package version. Answers from the index first and researches only when what is known is insufficient. Returns the likely cause, evidence, and a confidence score.',
    inputSchema: {
      type: 'object',
      required: ['package', 'error'],
      properties: {
        package: { type: 'string' },
        version: { type: 'string' },
        error: { type: 'string', description: 'The error message as printed' },
        stackTrace: { type: 'string' },
        indexOnly: { type: 'boolean', description: 'Never research; answer from the index or not at all' },
      },
    },
    async run(args) {
      const packageName = requireString(args, 'package');
      const resolution = await resolveError({
        package: packageName,
        ecosystem: ecosystemOf(args, packageName),
        version: optionalString(args, 'version'),
        error: requireString(args, 'error'),
        stackTrace: optionalString(args, 'stackTrace'),
        indexOnly: args.indexOnly === true,
      });

      return {
        diagnosis: resolution.diagnosis,
        likelyCause: resolution.likelyCause,
        fix: resolution.fix,
        affectedVersions: resolution.affectedVersions,
        fixedVersions: resolution.fixedVersions,
        confidence: resolution.confidence,
        confidenceCategory: resolution.confidenceCategory,
        caveat: resolution.caveat,
        evidence: resolution.evidence,
        trace: resolution.trace,
      };
    },
  },
  {
    name: 'research_upgrade',
    description:
      'Research what a package upgrade breaks, between two versions. Fetches and indexes sources, so it is the expensive call — prefer search_knowledge when the package is already indexed.',
    inputSchema: {
      type: 'object',
      required: ['package', 'from'],
      properties: {
        package: { type: 'string' },
        from: { type: 'string', description: 'The version currently installed' },
        to: { type: 'string', description: 'Target version. Resolved from the registry when omitted' },
        refresh: { type: 'boolean' },
      },
    },
    async run(args) {
      const packageName = requireString(args, 'package');
      const from = requireString(args, 'from');
      const to = optionalString(args, 'to');

      const result = await researchPackageUpgrade(
        {
          name: packageName,
          ecosystem: ecosystemOf(args, packageName),
          currentVersion: from,
          targetVersion: to,
          dependencyType: 'dependencies',
          specifier: from,
        },
        { refresh: args.refresh === true, targetVersion: to },
      );

      return {
        change: result.change,
        risk: result.risk,
        knowledge: result.knowledge.map((item) => ({
          id: item.id,
          type: item.type,
          title: item.title,
          severity: item.severity,
          affectedApis: item.affectedApis,
          migration: item.migration,
          confidence: item.confidence,
          sources: item.sources.map((source) => source.url),
        })),
        trace: result.trace,
        warnings: result.warnings,
      };
    },
  },
  {
    name: 'correlate_repository',
    description:
      'Find which files in a repository actually use a package. Each site records whether it was resolved by parsing the module graph or matched textually — a textual match is a lead, not a proof.',
    inputSchema: {
      type: 'object',
      required: ['repository', 'package'],
      properties: {
        repository: { type: 'string', description: 'Absolute path to the repository root' },
        package: { type: 'string' },
      },
    },
    async run(args) {
      const packageName = requireString(args, 'package');
      const knowledge = (await getStore().all()).filter((item) => item.package === packageName);
      const impact = await correlateRepository(requireString(args, 'repository'), packageName, knowledge);

      return {
        usesPackage: impact.usesPackage,
        scanned: impact.scanned,
        affectedFiles: impact.affectedFiles,
        affectedSymbols: impact.affectedSymbols,
        symbolSites: impact.symbolSites,
        importSites: impact.importSites,
        applicable: applicableKnowledge(knowledge, impact).map((item) => item.id),
      };
    },
  },
  {
    name: 'package_graph',
    description:
      'The knowledge graph for a package: which version introduced which change, and which version fixes a known error.',
    inputSchema: {
      type: 'object',
      required: ['package'],
      properties: {
        package: { type: 'string' },
        version: { type: 'string', description: 'Narrows to the subgraph around one version' },
        format: { type: 'string', enum: ['json', 'tree'] },
      },
    },
    async run(args) {
      const packageName = requireString(args, 'package');
      const knowledge = (await getStore().all()).filter((item) => item.package === packageName);
      const graph = subgraph(buildKnowledgeGraph(knowledge), {
        package: packageName,
        version: optionalString(args, 'version'),
      });

      return optionalString(args, 'format') === 'tree' ? renderKnowledgeGraph(graph, packageName) : graph;
    },
  },
  {
    name: 'report_fix',
    description:
      'Record whether a fix worked. Always report, including failures — a refutation lowers the confidence of bad knowledge. Pass the same error and stackTrace you sent to analyze_error, or the record cannot be linked back to the error it resolved.',
    inputSchema: {
      type: 'object',
      required: ['package', 'summary'],
      properties: {
        package: { type: 'string' },
        version: { type: 'string' },
        summary: { type: 'string', description: 'What was actually changed' },
        error: { type: 'string' },
        stackTrace: { type: 'string' },
        derivedFrom: { type: 'array', items: { type: 'string' }, description: 'Knowledge ids acted on' },
        tests: { type: 'string', enum: ['passed', 'failed', 'skipped'] },
        typecheck: { type: 'string', enum: ['passed', 'failed', 'skipped'] },
        build: { type: 'string', enum: ['passed', 'failed', 'skipped'] },
        repository: { type: 'string' },
      },
    },
    async run(args) {
      const validation = {
        tests: optionalString(args, 'tests') as 'passed' | 'failed' | 'skipped' | undefined,
        typecheck: optionalString(args, 'typecheck') as 'passed' | 'failed' | 'skipped' | undefined,
        build: optionalString(args, 'build') as 'passed' | 'failed' | 'skipped' | undefined,
      };

      if (!validation.tests && !validation.typecheck && !validation.build) {
        throw new Error('Report at least one of tests/typecheck/build — a fix without validation is not evidence');
      }

      return recordFixOutcome({
        package: requireString(args, 'package'),
        version: optionalString(args, 'version'),
        summary: requireString(args, 'summary'),
        error: optionalString(args, 'error'),
        stackTrace: optionalString(args, 'stackTrace'),
        fix: [],
        derivedFrom: Array.isArray(args.derivedFrom) ? (args.derivedFrom as string[]) : undefined,
        validation,
        repository: optionalString(args, 'repository'),
      });
    },
  },
];

function ok(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function fail(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

/**
 * Handles one message. Returns null for notifications, which by JSON-RPC must
 * not be answered.
 */
export async function handleMessage(message: JsonRpcMessage): Promise<JsonRpcResponse | null> {
  const id = message.id ?? null;

  if (!message.method) return fail(id, -32600, 'Missing method');
  // A notification has no id. Answering one is a protocol violation.
  if (message.method.startsWith('notifications/')) return null;

  switch (message.method) {
    case 'initialize':
      return ok(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions:
          'Package migration and error intelligence. Every answer carries the source sentence it came from and a confidence score. Findings below 0.75 are unconfirmed — report them, do not act on them silently.',
      });

    case 'ping':
      return ok(id, {});

    case 'tools/list':
      return ok(id, {
        tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      });

    case 'tools/call': {
      const params = message.params ?? {};
      const name = typeof params.name === 'string' ? params.name : '';
      const tool = TOOLS.find((candidate) => candidate.name === name);
      if (!tool) return fail(id, -32602, `Unknown tool: ${name || '(none)'}`);

      try {
        const output = await tool.run((params.arguments as Record<string, unknown>) ?? {});
        return ok(id, { content: [{ type: 'text', text: text(output) }] });
      } catch (error) {
        // A tool failure is a result, not a transport error: the agent needs to
        // see what went wrong and choose, rather than have the call disappear.
        return ok(id, {
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        });
      }
    }

    default:
      return fail(id, -32601, `Unknown method: ${message.method}`);
  }
}

/**
 * Reads newline-delimited JSON-RPC from stdin and writes responses to stdout.
 *
 * Nothing else may write to stdout while this runs — a stray log line corrupts
 * the stream. Diagnostics go to stderr.
 */
export async function runStdioServer(): Promise<void> {
  initializeEngine();

  const decoder = new TextDecoder();
  // `process.stdin` rather than `Bun.stdin`: the published bundle has to run
  // under plain `node` too, and a host that launches this with npx gets
  // "Bun is not defined" before the handshake. Async iteration over the stream
  // behaves the same on both runtimes.
  let buffer = '';

  for await (const chunk of process.stdin) {
    buffer += decoder.decode(chunk as Uint8Array, { stream: true });

    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');

      if (!line) continue;

      let response: JsonRpcResponse | null;
      try {
        response = await handleMessage(JSON.parse(line) as JsonRpcMessage);
      } catch (error) {
        response = fail(null, -32700, error instanceof Error ? error.message : 'Parse error');
      }

      // A frame lost to the pipe buffer is a corrupted protocol message, not a
      // short answer, so this write must not be droppable.
      if (response) writeStdout(`${JSON.stringify(response)}\n`);
    }
  }
}
