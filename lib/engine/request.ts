/**
 * The general ingestion interface (gen.md section 24).
 *
 * package.json is one input among several. Every entry point — CLI, HTTP API,
 * agent protocol, UI — normalizes to a `KnowledgeRequest` before the pipeline runs,
 * so adding an input type never reaches into the backend.
 */

import type { Ecosystem } from './knowledge';

export type KnowledgeRequestType = 'package_upgrade' | 'error' | 'repository' | 'query';

export interface KnowledgeRequest {
  type: KnowledgeRequestType;

  package?: string;
  fromVersion?: string;
  toVersion?: string;
  version?: string;
  ecosystem?: Ecosystem;

  error?: string;
  stackTrace?: string;

  repository?: string;

  query?: string;

  /** Skip cached research and force a refresh (gen.md section 23). */
  refresh?: boolean;
  /** Ceiling on documents fetched per package, to bound scrape cost. */
  maxDocuments?: number;
}

export interface PackageRef {
  name: string;
  ecosystem: Ecosystem;
  currentVersion: string;
  /** Undefined until resolved against the registry — never guessed by bumping majors. */
  targetVersion?: string;
  dependencyType: 'dependencies' | 'devDependencies' | 'peerDependencies' | 'optionalDependencies';
  /** Raw manifest specifier, e.g. `^6.0.0`. */
  specifier: string;
}

export class RequestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequestValidationError';
  }
}

export function validateRequest(request: KnowledgeRequest): KnowledgeRequest {
  switch (request.type) {
    case 'package_upgrade':
      if (!request.package) throw new RequestValidationError('package_upgrade requires `package`');
      if (!request.fromVersion && !request.version) {
        throw new RequestValidationError('package_upgrade requires `fromVersion` or `version`');
      }
      break;
    case 'error':
      if (!request.error) throw new RequestValidationError('error requests require `error`');
      if (!request.package) throw new RequestValidationError('error requests require `package`');
      break;
    case 'repository':
      if (!request.repository) throw new RequestValidationError('repository requests require `repository`');
      break;
    case 'query':
      if (!request.query) throw new RequestValidationError('query requests require `query`');
      break;
    default:
      throw new RequestValidationError(`unknown request type: ${(request as KnowledgeRequest).type}`);
  }
  return request;
}

export function packageUpgradeRequest(ref: PackageRef, overrides: Partial<KnowledgeRequest> = {}): KnowledgeRequest {
  return {
    type: 'package_upgrade',
    package: ref.name,
    ecosystem: ref.ecosystem,
    fromVersion: ref.currentVersion,
    toVersion: ref.targetVersion,
    ...overrides,
  };
}
