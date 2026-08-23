/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agent from "../agent.js";
import type * as analyses from "../analyses.js";
import type * as crons from "../crons.js";
import type * as embeddings from "../embeddings.js";
import type * as errors from "../errors.js";
import type * as fetchCache from "../fetchCache.js";
import type * as graph from "../graph.js";
import type * as http from "../http.js";
import type * as knowledge from "../knowledge.js";
import type * as maintenance from "../maintenance.js";
import type * as manifests from "../manifests.js";
import type * as model_analyses from "../model/analyses.js";
import type * as model_engine from "../model/engine.js";
import type * as model_fetchCache from "../model/fetchCache.js";
import type * as model_knowledge from "../model/knowledge.js";
import type * as model_knowledgeStore from "../model/knowledgeStore.js";
import type * as relay from "../relay.js";
import type * as relayLimits from "../relayLimits.js";
import type * as research from "../research.js";
import type * as validators from "../validators.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agent: typeof agent;
  analyses: typeof analyses;
  crons: typeof crons;
  embeddings: typeof embeddings;
  errors: typeof errors;
  fetchCache: typeof fetchCache;
  graph: typeof graph;
  http: typeof http;
  knowledge: typeof knowledge;
  maintenance: typeof maintenance;
  manifests: typeof manifests;
  "model/analyses": typeof model_analyses;
  "model/engine": typeof model_engine;
  "model/fetchCache": typeof model_fetchCache;
  "model/knowledge": typeof model_knowledge;
  "model/knowledgeStore": typeof model_knowledgeStore;
  relay: typeof relay;
  relayLimits: typeof relayLimits;
  research: typeof research;
  validators: typeof validators;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
