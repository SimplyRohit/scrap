import { describe, expect, test } from 'bun:test';

import { handleMessage, PROTOCOL_VERSION, TOOLS } from '../../mcp/server';

describe('protocol', () => {
  test('initialize advertises tools and the protocol version', async () => {
    const response = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    const result = response?.result as { protocolVersion: string; capabilities: Record<string, unknown> };

    expect(result.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(result.capabilities).toHaveProperty('tools');
  });

  test('a notification is never answered', async () => {
    // JSON-RPC forbids responding to a notification, and a client that receives
    // one will treat the stream as corrupt.
    expect(await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
  });

  test('every tool declares an object schema', async () => {
    const response = await handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const { tools } = response?.result as { tools: Array<{ name: string; inputSchema: { type: string } }> };

    expect(tools.length).toBe(TOOLS.length);
    expect(tools.every((tool) => tool.inputSchema.type === 'object')).toBe(true);
    expect(tools.every((tool) => tool.name && tool.name === tool.name.toLowerCase())).toBe(true);
  });

  test('an unknown method is a protocol error', async () => {
    const response = await handleMessage({ jsonrpc: '2.0', id: 3, method: 'resources/list' });
    expect(response?.error?.code).toBe(-32601);
  });

  test('an unknown tool is a protocol error', async () => {
    const response = await handleMessage({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'delete_everything', arguments: {} },
    });

    expect(response?.error?.code).toBe(-32602);
  });
});

describe('tool failures', () => {
  test('a bad argument comes back as a tool result, not a transport error', async () => {
    // The agent has to see what went wrong and choose. A transport error makes
    // the call disappear instead.
    const response = await handleMessage({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'analyze_error', arguments: { error: 'boom' } },
    });

    const result = response?.result as { isError?: boolean; content: Array<{ text: string }> };
    expect(response?.error).toBeUndefined();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('package');
  });

  test('a fix report with no validation is refused', async () => {
    // Same rule as the CLI: a fix nobody checked is not evidence.
    const response = await handleMessage({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { name: 'report_fix', arguments: { package: 'demo', summary: 'changed something' } },
    });

    const result = response?.result as { isError?: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('validation');
  });

  test('search needs something to search on', async () => {
    const response = await handleMessage({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'search_knowledge', arguments: {} },
    });

    const result = response?.result as { isError?: boolean };
    expect(result.isError).toBe(true);
  });
});

describe('tool descriptions', () => {
  test('search says what an empty result means', async () => {
    // The failure this prevents: an agent reading "no results" as "no such
    // change" and concluding the upgrade is safe.
    const search = TOOLS.find((tool) => tool.name === 'search_knowledge');
    expect(search?.description).toContain('not indexed yet');
  });

  test('report_fix says to pass the error back', async () => {
    // Without it the record cannot be linked to the error it resolved.
    const report = TOOLS.find((tool) => tool.name === 'report_fix');
    expect(report?.description).toContain('stackTrace');
  });
});
