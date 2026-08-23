import { describe, expect, test } from 'bun:test';

/**
 * Only a real shell pipeline reproduces this. `Bun.spawn`'s own pipes are large
 * enough to swallow the payload, so a spawn-and-read test passes even with the
 * bug present — verified by putting `process.stdout.write` back and watching it
 * stay green. The failure needs fd 1 to be an OS pipe with a 64 KiB buffer and a
 * reader that has not started yet.
 */
describe('writeStdout', () => {
  test('delivers a payload larger than the 64 KiB pipe buffer', async () => {
    const size = 500_000;
    const script = `${import.meta.dir}/fixtures/write-big.ts`;

    await Bun.write(
      script,
      `import { writeStdout } from '${import.meta.dir}/../stdout';\n` +
        `writeStdout('x'.repeat(${size}));\n` +
        `process.exit(0);\n`,
    );

    const child = Bun.spawn(['bash', '-c', `bun ${script} | wc -c`], { stdout: 'pipe', stderr: 'pipe' });
    const [out, err] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);

    expect(err).toBe('');
    expect(Number(out.trim())).toBe(size);
  });
});
