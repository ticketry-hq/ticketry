import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import readline from 'node:readline';
import test from 'node:test';
import { callSocketMcpTool, listSocketMcpTools } from './mcp-socket-client.mjs';

test('global fixture client authenticates and initializes before calling a socket tool', async () => {
  const directory = await mkdtemp('/tmp/ticketry-mcp-client-');
  const messages = [];
  const server = net.createServer((socket) => {
    readline.createInterface({ input: socket }).on('line', (line) => {
      const message = JSON.parse(line);
      messages.push(message);
      const result = message.ticketry_mcp_auth
        ? { ticketry_mcp_auth: 1, ok: true }
        : message.method === 'initialize'
          ? { jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2024-11-05', capabilities: {} } }
          : message.method === 'tools/call'
            ? { jsonrpc: '2.0', id: message.id, result: { structuredContent: { owner: 'alpha' } } }
            : null;
      if (result) socket.write(`${JSON.stringify(result)}\n`);
    });
  });
  try {
    server.listen(path.join(directory, 'mcp.sock'));
    await once(server, 'listening');
    assert.deepEqual(await callSocketMcpTool(directory, 'mcp_ping', {}), { structuredContent: { owner: 'alpha' } });
    assert.deepEqual(messages.map((message) => message.method ?? message.mode), [
      'global', 'initialize', 'notifications/initialized', 'tools/call',
    ]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test('global fixture client lists the published tool names', async () => {
  const directory = await mkdtemp('/tmp/ticketry-mcp-client-');
  const messages = [];
  const server = net.createServer((socket) => {
    readline.createInterface({ input: socket }).on('line', (line) => {
      const message = JSON.parse(line);
      messages.push(message);
      const result = message.ticketry_mcp_auth
        ? { ticketry_mcp_auth: 1, ok: true }
        : message.method === 'initialize'
          ? { jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2024-11-05', capabilities: {} } }
          : message.method === 'tools/list'
            ? { jsonrpc: '2.0', id: message.id, result: { tools: [{ name: 'mcp_ping' }, { name: 'list_sprints' }] } }
            : null;
      if (result) socket.write(`${JSON.stringify(result)}\n`);
    });
  });
  try {
    server.listen(path.join(directory, 'mcp.sock'));
    await once(server, 'listening');
    assert.deepEqual(await listSocketMcpTools(directory), ['mcp_ping', 'list_sprints']);
    assert.deepEqual(messages.map((message) => message.method ?? message.mode), [
      'global', 'initialize', 'notifications/initialized', 'tools/list',
    ]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
