import { describe, expect, test } from 'bun:test';

import { describeJsonError, formatManifest, inspectManifest } from '../manifest-editor';

describe('inspectManifest', () => {
  test('counts what the backend will count', () => {
    const status = inspectManifest(
      JSON.stringify({ dependencies: { chalk: '4.1.2' }, devDependencies: { typescript: '5.0.0' } }),
      'package.json',
    );

    expect(status).toEqual({ kind: 'valid', ecosystem: 'nodejs', packages: 2 });
  });

  test('reads requirements.txt', () => {
    const status = inspectManifest('requests==2.31.0\n# a comment\nflask==3.0.0\n', 'requirements.txt');

    expect(status).toEqual({ kind: 'valid', ecosystem: 'python', packages: 2 });
  });

  test('an empty field is not an error', () => {
    expect(inspectManifest('   \n ', 'package.json').kind).toBe('empty');
  });

  /**
   * The reason this check exists at all: `parseManifest` does not throw on
   * malformed JSON, it falls through to the line parser. Without catching it
   * here, a missing brace produced a confident analysis of nothing.
   */
  test('malformed JSON is reported rather than parsed as lines', () => {
    const status = inspectManifest('{ "dependencies": { "chalk": "4.1.2" ', 'package.json');

    expect(status.kind).toBe('invalid');
  });
});

describe('describeJsonError', () => {
  test('prefers the line the engine names', () => {
    const error = new Error("Expected ',' after property value in JSON at position 214 (line 7 column 3)");

    expect(describeJsonError(error, '')).toBe('Invalid JSON · line 7');
  });

  test('falls back to counting newlines up to the offset', () => {
    const source = 'one\ntwo\nthree\nbroken';
    const error = new Error('Unexpected token at position 14');

    expect(describeJsonError(error, source)).toBe('Invalid JSON · line 4');
  });

  test('says something useful when the engine names nothing', () => {
    expect(describeJsonError(new Error("JSON Parse error: Expected '}'"), '')).toBe('Invalid JSON');
  });
});

describe('formatManifest', () => {
  test('re-indents JSON to two spaces', () => {
    expect(formatManifest('{"dependencies":{"chalk":"4.1.2"}}')).toBe(
      '{\n  "dependencies": {\n    "chalk": "4.1.2"\n  }\n}\n',
    );
  });

  test('leaves JSON it cannot parse alone', () => {
    const broken = '{ "dependencies": ';

    expect(formatManifest(broken)).toBe(broken);
  });

  test('tidies a requirements file without reordering it', () => {
    expect(formatManifest('flask==3.0.0   \n\n\n\n# pinned\nrequests==2.31.0')).toBe(
      'flask==3.0.0\n\n# pinned\nrequests==2.31.0\n',
    );
  });
});
