/**
 * Registry server tests using Node built-in test runner.
 * Uses an in-memory SQLite DB so tests don't touch the real registry.db.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// ---- Inline a minimal test server ----
// We re-implement the core of server.js with DB_PATH=':memory:' so we can
// start/stop it cleanly without touching the real registry.db.

import express from 'express';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

function buildApp(db) {
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      endpoint_url TEXT NOT NULL,
      capabilities TEXT NOT NULL,
      price_usdc TEXT NOT NULL,
      stellar_address TEXT NOT NULL,
      registered_at TEXT NOT NULL
    )
  `);

  const insertAgent = db.prepare(
    `INSERT INTO agents (id, endpoint_url, capabilities, price_usdc, stellar_address, registered_at) VALUES (?, ?, ?, ?, ?, ?)`
  );
  const getAgentById = db.prepare(`SELECT * FROM agents WHERE id = ?`);
  const getAllAgents = db.prepare(`SELECT * FROM agents ORDER BY registered_at DESC`);

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.sendStatus(200); return; }
    next();
  });

  function formatAgent(row) {
    return {
      id: row.id,
      endpointUrl: row.endpoint_url,
      capabilities: JSON.parse(row.capabilities),
      priceUsdc: row.price_usdc,
      stellarAddress: row.stellar_address,
      registeredAt: row.registered_at,
    };
  }

  app.get('/agents', (req, res) => {
    const capability = req.query.capability;
    let rows;
    if (capability) {
      const stmt = db.prepare(`SELECT * FROM agents WHERE capabilities LIKE ? ORDER BY registered_at DESC`);
      rows = stmt.all(`%"${capability}"%`);
    } else {
      rows = getAllAgents.all();
    }
    res.json(rows.map(formatAgent));
  });

  app.get('/agents/:id', (req, res) => {
    const row = getAgentById.get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Agent not found' });
    res.json(formatAgent(row));
  });

  app.post('/agents', (req, res) => {
    const { endpointUrl, capabilities, priceUsdc, stellarAddress } = req.body;
    if (!endpointUrl || !capabilities || !priceUsdc || !stellarAddress) {
      return res.status(400).json({
        error: 'Missing required fields: endpointUrl, capabilities, priceUsdc, stellarAddress',
      });
    }
    const id = randomUUID();
    const registeredAt = new Date().toISOString();
    insertAgent.run(id, endpointUrl, JSON.stringify(capabilities), priceUsdc, stellarAddress, registeredAt);
    res.status(201).json(formatAgent({
      id,
      endpoint_url: endpointUrl,
      capabilities: JSON.stringify(capabilities),
      price_usdc: priceUsdc,
      stellar_address: stellarAddress,
      registered_at: registeredAt,
    }));
  });

  return app;
}

// ---- Test helpers ----

let server;
let baseUrl;
let db;

before(() => {
  db = new Database(':memory:');
  const app = buildApp(db);
  server = http.createServer(app);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    baseUrl = `http://127.0.0.1:${port}`;
    resolve();
  }));
});

after(() => {
  return new Promise((resolve) => server.close(() => { db.close(); resolve(); }));
});

async function req(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, { ...opts, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

// ---- Tests ----

test('GET /agents returns empty array initially', async () => {
  const { status, body } = await req('GET', '/agents');
  assert.equal(status, 200);
  assert.ok(Array.isArray(body));
  assert.equal(body.length, 0);
});

test('POST /agents registers a new agent', async () => {
  const payload = {
    endpointUrl: 'http://localhost:3010',
    capabilities: ['data', 'fetch'],
    priceUsdc: '0.001',
    stellarAddress: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  };
  const { status, body } = await req('POST', '/agents', payload);
  assert.equal(status, 201);
  assert.ok(body.id);
  assert.equal(body.endpointUrl, payload.endpointUrl);
  assert.deepEqual(body.capabilities, payload.capabilities);
  assert.equal(body.priceUsdc, payload.priceUsdc);
  assert.equal(body.stellarAddress, payload.stellarAddress);
  assert.ok(body.registeredAt);
});

test('GET /agents returns the registered agent', async () => {
  const { status, body } = await req('GET', '/agents');
  assert.equal(status, 200);
  assert.ok(Array.isArray(body));
  assert.ok(body.length >= 1);
  const agent = body[0];
  assert.ok(agent.id);
  assert.ok(Array.isArray(agent.capabilities));
});

test('GET /agents/:id returns the agent by id', async () => {
  // Register a new agent to get its ID
  const payload = {
    endpointUrl: 'http://localhost:3011',
    capabilities: ['compute'],
    priceUsdc: '0.005',
    stellarAddress: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  };
  const { body: created } = await req('POST', '/agents', payload);

  const { status, body } = await req('GET', `/agents/${created.id}`);
  assert.equal(status, 200);
  assert.equal(body.id, created.id);
  assert.equal(body.endpointUrl, payload.endpointUrl);
});

test('GET /agents/:id returns 404 for unknown id', async () => {
  const { status, body } = await req('GET', '/agents/nonexistent-id');
  assert.equal(status, 404);
  assert.equal(body.error, 'Agent not found');
});

test('GET /agents?capability= filters by capability', async () => {
  // Register a data agent and a compute agent
  await req('POST', '/agents', {
    endpointUrl: 'http://localhost:3012',
    capabilities: ['data'],
    priceUsdc: '0.001',
    stellarAddress: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  });
  await req('POST', '/agents', {
    endpointUrl: 'http://localhost:3013',
    capabilities: ['action'],
    priceUsdc: '0.002',
    stellarAddress: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  });

  const { status, body } = await req('GET', '/agents?capability=action');
  assert.equal(status, 200);
  assert.ok(Array.isArray(body));
  const actionAgents = body.filter(a => a.capabilities.includes('action'));
  assert.ok(actionAgents.length >= 1, 'at least one action agent returned');
  // No data-only agents in the result
  const wrongCap = body.filter(a => !a.capabilities.includes('action'));
  assert.equal(wrongCap.length, 0, 'only action agents returned');
});

test('POST /agents returns 400 when required fields are missing', async () => {
  const { status, body } = await req('POST', '/agents', { endpointUrl: 'http://x.com' });
  assert.equal(status, 400);
  assert.ok(body.error.includes('Missing required fields'));
});

test('POST /agents returns 400 when capabilities is missing', async () => {
  const { status, body } = await req('POST', '/agents', {
    endpointUrl: 'http://x.com',
    priceUsdc: '0.001',
    stellarAddress: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  });
  assert.equal(status, 400);
  assert.ok(body.error.includes('Missing required fields'));
});

test('CORS headers are present on all responses', async () => {
  const url = `${baseUrl}/agents`;
  const res = await fetch(url);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
});

test('OPTIONS preflight returns 200', async () => {
  const url = `${baseUrl}/agents`;
  const res = await fetch(url, { method: 'OPTIONS' });
  assert.equal(res.status, 200);
});
