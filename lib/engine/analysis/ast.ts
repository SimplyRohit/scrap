/**
 * AST-backed module analysis for repository correlation (gen.md section 14).
 *
 * Regex correlation answers "does this line mention the symbol". That misses the
 * three cases that matter most in real repositories:
 *
 *   import { render as r } from 'pkg'   // the symbol is renamed
 *   export { render } from 'pkg'        // a barrel re-exports it
 *   import * as ns from 'pkg'           // it becomes a member access
 *
 * Parsing resolves all three, because a usage is recorded against the *source
 * module's* export name rather than against whatever the local file calls it.
 *
 * The parser is TypeScript's, loaded lazily. `typescript` is a devDependency, so a
 * deployed runtime may not have it: `loadTypeScript` returns null instead of
 * throwing, and the caller falls back to regex matching. Non-JS ecosystems
 * (Python, Vue/Svelte single-file components) have no parser here either and take
 * the same fallback.
 */

import path from 'node:path';

import type * as TypeScript from 'typescript';

type Ts = typeof TypeScript;

/**
 * `named` is a specific export (`import { render }`). `whole` is the module object
 * itself — a default import, a namespace import, or a `require()` — where the local
 * name is arbitrary and only the member path carries meaning.
 */
export type BindingKind = 'named' | 'whole';

export interface RawUsage {
  /** Index into `ModuleFacts.groups`, which says where the binding came from. */
  group: number;
  /** Name as the *source* module exports it. Ignored when `kind` is `whole`. */
  exported: string;
  kind: BindingKind;
  /** Member path read off the binding: `ns.a.b()` gives `['a','b']`. */
  path: string[];
  /** Called or constructed at this site. */
  called: boolean;
  /** Reached through a computed access (`ns[name]`) — a lead, not a certainty. */
  dynamic: boolean;
  line: number;
  text: string;
}

export interface ImportGroup {
  /** The specifier as written. */
  specifier: string;
  /** Absolute path, filled in later by resolving against the scanned file set. */
  resolved: string | null;
  /** Lines of the statement that produced this group. */
  sites: { line: number; text: string }[];
  /** `export … from` — names taken here leave again under `outward`. */
  reExport: boolean;
  /** `export * from` — everything passes through under its own name. */
  starReExport: boolean;
  /** Outward export name -> name in the source module (`export { a as b } from`). */
  outward: Map<string, string>;
}

export interface ModuleFacts {
  groups: ImportGroup[];
  usages: RawUsage[];
  /** True when a cap was hit and some usages were dropped. */
  truncated: boolean;
}

const MAX_USAGES_PER_FILE = 400;

const JS_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

/** Extensions tried when resolving a relative specifier, in Node's order. */
const RESOLUTION_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

export function isParseableModule(file: string): boolean {
  return JS_EXTENSIONS.includes(path.extname(file).toLowerCase());
}

let cachedTs: Ts | null | undefined;

/**
 * Loads the TypeScript compiler if it is installed. Cached, including the failure:
 * a repository scan asks thousands of times and the answer never changes.
 */
export async function loadTypeScript(): Promise<Ts | null> {
  if (cachedTs !== undefined) return cachedTs;

  try {
    // A computed specifier so bundlers leave it alone; if it is absent at runtime
    // the import rejects and correlation degrades to regex rather than failing.
    const moduleName = 'typescript';
    const loaded = (await import(moduleName)) as unknown as { default?: Ts } & Ts;
    cachedTs = (loaded.default ?? loaded) as Ts;
    if (typeof cachedTs?.createSourceFile !== 'function') cachedTs = null;
  } catch {
    cachedTs = null;
  }

  return cachedTs;
}

/** Test seam: forces the "parser unavailable" branch without uninstalling anything. */
export function setTypeScriptForTesting(value: Ts | null | undefined): void {
  cachedTs = value;
}

function scriptKind(ts: Ts, file: string): TypeScript.ScriptKind {
  switch (path.extname(file).toLowerCase()) {
    case '.tsx':
      return ts.ScriptKind.TSX;
    case '.ts':
    case '.mts':
    case '.cts':
      return ts.ScriptKind.TS;
    default:
      // JSX rather than JS: React in a plain `.js` file is common, and the JSX
      // parser accepts everything the JS parser does.
      return ts.ScriptKind.JSX;
  }
}

function lineText(lines: string[], line: number): string {
  return (lines[line - 1] ?? '').trim().slice(0, 240);
}

/**
 * Parses one module into the bindings it takes and the usages it makes of them.
 *
 * Returns facts for every specifier, not just the package under investigation:
 * relative specifiers are what let a later pass follow barrel re-exports, and it
 * cannot know which relative files matter until every file has been read.
 */
export function parseModule(ts: Ts, file: string, content: string): ModuleFacts | null {
  let source: TypeScript.SourceFile;
  try {
    source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, scriptKind(ts, file));
  } catch {
    return null;
  }

  // A file that does not parse cleanly yields a partial tree, and a partial tree
  // silently loses bindings. Better to hand it back to the regex scanner, which
  // makes no structural assumptions, than to report confident half-answers.
  // `parseDiagnostics` is internal, so its absence is treated as "no errors".
  const diagnostics = (source as unknown as { parseDiagnostics?: readonly unknown[] }).parseDiagnostics;
  if (diagnostics && diagnostics.length > 0) return null;

  const lines = content.split('\n');
  const facts: ModuleFacts = { groups: [], usages: [], truncated: false };

  /** local name -> where it came from. Later declarations win, as JS scoping does. */
  const locals = new Map<string, { group: number; exported: string; kind: BindingKind }>();
  /** Module-level names declared *not* by an import — these shadow, so we drop them. */
  const shadowed = new Set<string>();

  const lineOf = (node: TypeScript.Node): number =>
    source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

  const addGroup = (
    specifier: string,
    node: TypeScript.Node,
    options: { reExport?: boolean; starReExport?: boolean } = {},
  ): number => {
    const line = lineOf(node);
    const existing = facts.groups.findIndex(
      (group) => group.specifier === specifier && group.reExport === Boolean(options.reExport),
    );

    if (existing !== -1) {
      facts.groups[existing].sites.push({ line, text: lineText(lines, line) });
      if (options.starReExport) facts.groups[existing].starReExport = true;
      return existing;
    }

    facts.groups.push({
      specifier,
      resolved: null,
      sites: [{ line, text: lineText(lines, line) }],
      reExport: Boolean(options.reExport),
      starReExport: Boolean(options.starReExport),
      outward: new Map(),
    });

    return facts.groups.length - 1;
  };

  const bind = (local: string, group: number, exported: string, kind: BindingKind) => {
    locals.set(local, { group, exported, kind });
  };

  const pushUsage = (usage: RawUsage) => {
    if (facts.usages.length >= MAX_USAGES_PER_FILE) {
      facts.truncated = true;
      return;
    }
    facts.usages.push(usage);
  };

  const specifierOf = (node: TypeScript.Node | undefined): string | null =>
    node && ts.isStringLiteralLike(node) ? node.text : null;

  // ---- Pass A: bindings ---------------------------------------------------

  const collectBindings = (node: TypeScript.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const specifier = specifierOf(node.moduleSpecifier);
      if (specifier) {
        const group = addGroup(specifier, node);
        const clause = node.importClause;

        if (clause?.name) bind(clause.name.text, group, 'default', 'whole');

        const named = clause?.namedBindings;
        if (named && ts.isNamespaceImport(named)) {
          bind(named.name.text, group, '*', 'whole');
        } else if (named && ts.isNamedImports(named)) {
          for (const element of named.elements) {
            const exported = element.propertyName?.text ?? element.name.text;
            bind(element.name.text, group, exported, 'named');
          }
        }
      }
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const specifier = specifierOf(node.moduleSpecifier);
      if (specifier) {
        const clause = node.exportClause;
        const isStar = !clause || ts.isNamespaceExport(clause);
        const group = addGroup(specifier, node, { reExport: true, starReExport: isStar });

        if (clause && ts.isNamedExports(clause)) {
          for (const element of clause.elements) {
            const exported = element.propertyName?.text ?? element.name.text;
            facts.groups[group].outward.set(element.name.text, exported);

            // A re-export is itself a use of the name: `export { legacy } from 'pkg'`
            // breaks when `legacy` is removed, even though nothing here calls it.
            const line = lineOf(element);
            pushUsage({
              group,
              exported,
              kind: 'named',
              path: [],
              called: false,
              dynamic: false,
              line,
              text: lineText(lines, line),
            });
          }
        }
      }
    } else if (ts.isImportEqualsDeclaration(node)) {
      const reference = node.moduleReference;
      if (ts.isExternalModuleReference(reference)) {
        const specifier = specifierOf(reference.expression);
        if (specifier) bind(node.name.text, addGroup(specifier, node), '*', 'whole');
      }
    } else if (ts.isCallExpression(node)) {
      // `require('pkg')` and `import('pkg')`, assigned or not.
      const callee = node.expression;
      const isRequire = ts.isIdentifier(callee) && callee.text === 'require';
      const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword;

      if ((isRequire || isDynamicImport) && node.arguments.length > 0) {
        const specifier = specifierOf(node.arguments[0]);
        if (specifier) {
          const group = addGroup(specifier, node);
          const declaration = variableDeclarationFor(ts, node);

          if (declaration && ts.isIdentifier(declaration.name)) {
            bind(declaration.name.text, group, '*', 'whole');
          } else if (declaration && ts.isObjectBindingPattern(declaration.name)) {
            for (const element of declaration.name.elements) {
              if (!ts.isIdentifier(element.name)) continue;
              const exported =
                element.propertyName && ts.isIdentifier(element.propertyName)
                  ? element.propertyName.text
                  : element.name.text;
              bind(element.name.text, group, exported, 'named');
            }
          }
        }
      }
    } else if (ts.isVariableStatement(node) || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) {
      // Module-level declarations that could shadow an import name.
      if (ts.isVariableStatement(node)) {
        for (const declaration of node.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name) && !isModuleRequire(ts, declaration)) {
            shadowed.add(declaration.name.text);
          }
        }
      } else if (node.name) {
        shadowed.add(node.name.text);
      }
    }

    ts.forEachChild(node, collectBindings);
  };

  collectBindings(source);

  for (const name of shadowed) {
    // A local declaration of the same name means identifier matches are ambiguous;
    // dropping the binding loses a finding, keeping it invents one.
    if (locals.has(name)) locals.delete(name);
  }

  if (locals.size === 0 && facts.groups.length === 0) return facts;

  // ---- Pass B: usages ----------------------------------------------------

  const visitUsages = (node: TypeScript.Node): void => {
    if (ts.isIdentifier(node) && locals.has(node.text) && isReference(ts, node)) {
      const binding = locals.get(node.text)!;
      const { path: memberPath, dynamic, outermost } = climb(ts, node);
      const parent = outermost.parent;
      const called = Boolean(
        parent &&
          (ts.isCallExpression(parent) || ts.isNewExpression(parent)) &&
          parent.expression === outermost,
      );
      const line = lineOf(node);

      pushUsage({
        group: binding.group,
        exported: binding.exported,
        kind: binding.kind,
        path: memberPath,
        called,
        dynamic,
        line,
        text: lineText(lines, line),
      });
    }

    ts.forEachChild(node, visitUsages);
  };

  visitUsages(source);

  return facts;
}

/** The `const x = require('y')` declaration around a call, if there is one. */
function variableDeclarationFor(ts: Ts, call: TypeScript.CallExpression): TypeScript.VariableDeclaration | null {
  let node: TypeScript.Node = call;

  // Step over the wrappers that legitimately sit between the call and the binding.
  while (node.parent && (ts.isAwaitExpression(node.parent) || ts.isParenthesizedExpression(node.parent))) {
    node = node.parent;
  }

  const parent = node.parent;
  if (parent && ts.isVariableDeclaration(parent) && parent.initializer === node) return parent;
  return null;
}

function isModuleRequire(ts: Ts, declaration: TypeScript.VariableDeclaration): boolean {
  let initializer = declaration.initializer;
  while (initializer && (ts.isAwaitExpression(initializer) || ts.isParenthesizedExpression(initializer))) {
    initializer = initializer.expression;
  }
  if (!initializer || !ts.isCallExpression(initializer)) return false;

  const callee = initializer.expression;
  return (
    (ts.isIdentifier(callee) && callee.text === 'require') || callee.kind === ts.SyntaxKind.ImportKeyword
  );
}

/**
 * True when the identifier reads a binding rather than declaring or naming one.
 *
 * The `parent.name === node` test covers most of it in one stroke: declaration
 * names, property-access members, object keys, JSX attribute names, and import
 * specifier locals all sit in a `name` slot.
 */
function isReference(ts: Ts, node: TypeScript.Identifier): boolean {
  const parent = node.parent as (TypeScript.Node & { name?: TypeScript.Node; propertyName?: TypeScript.Node; right?: TypeScript.Node }) | undefined;
  if (!parent) return false;

  if (parent.name === node) return false;
  if (parent.propertyName === node) return false;
  if (ts.isQualifiedName(parent) && parent.right === node) return false;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return false;

  return true;
}

/**
 * Walks outward from an identifier through member accesses, collecting the path.
 *
 * A computed access stops the walk: past `ns[name]` the path is unknown, and
 * guessing at it would report a symbol the file may never touch.
 */
function climb(
  ts: Ts,
  identifier: TypeScript.Identifier,
): { path: string[]; dynamic: boolean; outermost: TypeScript.Node } {
  const memberPath: string[] = [];
  let node: TypeScript.Node = identifier;
  let dynamic = false;

  for (;;) {
    const parent = node.parent;
    if (!parent) break;

    if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
      memberPath.push(parent.name.text);
      node = parent;
      continue;
    }

    if (ts.isElementAccessExpression(parent) && parent.expression === node) {
      const argument = parent.argumentExpression;
      if (ts.isStringLiteralLike(argument)) {
        memberPath.push(argument.text);
        node = parent;
        continue;
      }
      dynamic = true;
      node = parent;
      break;
    }

    break;
  }

  return { path: memberPath, dynamic, outermost: node };
}

/**
 * Names a package might be written under in a changelog.
 *
 * Maintainers write `axios.create()`, not `<whatever you imported it as>.create()`,
 * so a whole-module usage has to be offered under the package's own name to match.
 */
export function packageAliases(packageName: string): string[] {
  const withoutScope = packageName.replace(/^@[^/]+\//, '');
  const base = withoutScope.split('/')[0];

  const aliases = new Set<string>([
    packageName,
    withoutScope,
    base,
    // PyPI distribution name -> module name, and the camelCase form JS docs use.
    base.replace(/-/g, '_'),
    base.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase()),
  ]);

  return [...aliases].filter(Boolean);
}

/**
 * Every name a usage could reasonably be called in a changelog.
 *
 * Both the bare form and the package-qualified form are produced, because sources
 * are inconsistent about which they use for the same API.
 */
export function usageCandidates(usage: RawUsage, aliases: string[]): string[] {
  const candidates = new Set<string>();

  const qualify = (name: string) => {
    candidates.add(name);
    for (const alias of aliases) candidates.add(`${alias}.${name}`);
  };

  if (usage.kind === 'whole') {
    if (usage.path.length === 0) {
      // The module object itself, e.g. `axios(config)`.
      for (const alias of aliases) candidates.add(alias);
    } else {
      qualify(usage.path.join('.'));
      if (usage.path.length > 1) qualify(usage.path[usage.path.length - 1]);
    }
  } else {
    qualify([usage.exported, ...usage.path].join('.'));
    if (usage.path.length > 0) qualify(usage.path.join('.'));
  }

  return [...candidates];
}

/**
 * Strips a knowledge symbol down to a comparable name.
 *
 * The leading segment is lowercased when it is a package alias, so a changelog's
 * `Axios.create()` still lines up with a usage recorded under `axios.create`.
 */
export function normalizeSymbol(symbol: string, aliases: string[]): string {
  const cleaned = symbol.trim().replace(/^`|`$/g, '').replace(/\(\s*\)$/, '').replace(/^[@]?/, (m) => m);
  const lower = new Set(aliases.map((alias) => alias.toLowerCase()));

  const dot = cleaned.indexOf('.');
  if (dot > 0) {
    const head = cleaned.slice(0, dot);
    if (lower.has(head.toLowerCase())) return `${head.toLowerCase()}${cleaned.slice(dot)}`;
  }

  return cleaned;
}

/**
 * Resolves a relative specifier against the set of files actually scanned.
 *
 * Using the scanned set rather than the filesystem keeps resolution consistent with
 * what correlation looked at, and costs no extra stat calls.
 */
export function resolveRelative(fromFile: string, specifier: string, known: Set<string>): string | null {
  if (!specifier.startsWith('.')) return null;

  const base = path.resolve(path.dirname(fromFile), specifier);

  if (known.has(base)) return base;
  for (const extension of RESOLUTION_EXTENSIONS) {
    if (known.has(base + extension)) return base + extension;
  }
  for (const extension of RESOLUTION_EXTENSIONS) {
    const indexed = path.join(base, `index${extension}`);
    if (known.has(indexed)) return indexed;
  }

  // A `.js` specifier in an ESM TypeScript project points at the `.ts` source.
  const swapped = base.replace(/\.(js|mjs|cjs)$/, '');
  if (swapped !== base) {
    for (const extension of ['.ts', '.mts', '.cts', '.tsx']) {
      if (known.has(swapped + extension)) return swapped + extension;
    }
  }

  return null;
}

/** True when a specifier imports this package, including any subpath. */
export function specifierMatchesPackage(specifier: string, packageName: string): boolean {
  if (specifier === packageName) return true;
  if (specifier.startsWith(`${packageName}/`)) return true;

  // Python: `from llama_index.core import x` for the `llama-index` distribution.
  const moduleName = packageName.replace(/^@[^/]+\//, '').replace(/-/g, '_');
  return specifier === moduleName || specifier.startsWith(`${moduleName}.`);
}
