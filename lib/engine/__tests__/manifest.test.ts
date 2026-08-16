import { describe, expect, test } from 'bun:test';

import { applyLockfileVersions, detectEcosystem, parseManifest, versionFromSpecifier } from '../ingestion/manifest';

describe('package.json', () => {
  test('reads every dependency group and records which one', () => {
    const result = parseManifest(
      JSON.stringify({
        dependencies: { next: '^15.0.0' },
        devDependencies: { typescript: '5.5.3' },
        peerDependencies: { react: '>=18' },
      }),
      'package.json',
    );

    expect(result.format).toBe('package.json');
    expect(result.packages).toHaveLength(3);
    expect(result.packages.find((pkg) => pkg.name === 'typescript')?.dependencyType).toBe('devDependencies');
  });

  test('never invents a target version', () => {
    // Guessing a target produces confident nonsense downstream; resolution is the
    // registry's job.
    const result = parseManifest(JSON.stringify({ dependencies: { next: '^15.0.0' } }), 'package.json');
    expect(result.packages[0].targetVersion).toBeUndefined();
    expect(result.packages[0].currentVersion).toBe('15.0.0');
  });

  test('warns instead of dropping local specifiers silently', () => {
    const result = parseManifest(
      JSON.stringify({ dependencies: { local: 'workspace:*', ok: '1.0.0' } }),
      'package.json',
    );

    expect(result.packages.map((pkg) => pkg.name)).toEqual(['ok']);
    expect(result.warnings.join(' ')).toContain('local');
  });

  test('falls back to the line parser on malformed JSON', () => {
    const result = parseManifest('{ this is not json', 'package.json');
    expect(result.format).toBe('requirements.txt');
  });
});

describe('requirements.txt', () => {
  test('parses pins and skips flags and comments', () => {
    const result = parseManifest(
      ['# comment', '-r base.txt', 'pydantic==1.10.8', 'fastapi>=0.95.2', 'unpinned'].join('\n'),
      'requirements.txt',
    );

    expect(result.packages.map((pkg) => pkg.name)).toEqual(['pydantic', 'fastapi']);
    expect(result.warnings.join(' ')).toContain('unpinned');
  });

  test('detects a specialised ecosystem from its members', () => {
    const result = parseManifest('langchain==0.0.350\nrequests==2.28.2', 'requirements.txt');
    expect(result.ecosystem).toBe('langchain');
  });
});

describe('pyproject.toml', () => {
  test('reads PEP 621 dependencies', () => {
    const result = parseManifest(
      ['[project]', 'name = "app"', 'dependencies = ["fastapi>=0.111", "pydantic==2.5.0"]'].join('\n'),
      'pyproject.toml',
    );

    expect(result.format).toBe('pyproject.toml');
    expect(result.packages.map((pkg) => pkg.name)).toEqual(['fastapi', 'pydantic']);
  });

  test('reads Poetry tables and excludes the python constraint', () => {
    const result = parseManifest(
      ['[tool.poetry.dependencies]', 'python = "^3.11"', 'httpx = "^0.27.0"'].join('\n'),
      'pyproject.toml',
    );

    expect(result.packages.map((pkg) => pkg.name)).toEqual(['httpx']);
  });
});

describe('applyLockfileVersions', () => {
  test('pins to what is installed rather than what is permitted', () => {
    // `^6.0.0` with 6.4.2 installed is a 6.4.2 upgrade problem, not a 6.0.0 one.
    const parsed = parseManifest(JSON.stringify({ dependencies: { demo: '^6.0.0' } }), 'package.json');
    const lock = JSON.stringify({ packages: { 'node_modules/demo': { version: '6.4.2' } } });

    const { packages, matched } = applyLockfileVersions(parsed.packages, lock);
    expect(matched).toBe(1);
    expect(packages[0].currentVersion).toBe('6.4.2');
  });

  test('leaves packages the lockfile does not mention', () => {
    const parsed = parseManifest(JSON.stringify({ dependencies: { demo: '1.0.0' } }), 'package.json');
    const { packages, matched } = applyLockfileVersions(parsed.packages, '{}');

    expect(matched).toBe(0);
    expect(packages[0].currentVersion).toBe('1.0.0');
  });
});

describe('helpers', () => {
  test('versionFromSpecifier pulls a concrete version out of a range', () => {
    expect(versionFromSpecifier('^6.0.0')).toBe('6.0.0');
    expect(versionFromSpecifier('>=1.2,<2')).toBe('1.2');
    expect(versionFromSpecifier('*')).toBeNull();
  });

  test('detectEcosystem prefers a specialised match', () => {
    expect(detectEcosystem('langchain-community', 'nodejs')).toBe('langchain');
    expect(detectEcosystem('llama-index-core', 'nodejs')).toBe('llamaindex');
    expect(detectEcosystem('torch', 'nodejs')).toBe('aiml');
    expect(detectEcosystem('next', 'python')).toBe('nodejs');
    expect(detectEcosystem('some-unknown-lib', 'python')).toBe('python');
  });
});
