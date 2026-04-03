/**
 * AgentMesh Registry — lightweight agent discovery service.
 *
 * Agents register with endpoint URL, capability tags, pricing, and Stellar address.
 * The Coordinator queries it to build a task execution plan.
 *
 * Storage: SQLite (single file, no external DB).
 * No auth for hackathon scope.
 */

import express from 'express';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

const PORT = process.env.PORT || 3001;
const DB_PATH = process.env.DB_PATH || './registry.db';

// --- Database setup ---
const db = new Database(DB_PATH);
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

const insertAgent = db.prepare(`
  INSERT INTO agents (id, endpoint_url, capabilities, price_usdc, stellar_address, registered_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const getAgentById = db.prepare(`SELECT * FROM agents WHERE id = ?`);
const getAllAgents = db.prepare(`SELECT * FROM agents ORDER BY registered_at DESC`);

// --- Express app ---
const app = express();
app.use(express.json());

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

// GET /agents?capability=data
app.get('/agents', (req, res) => {
  const capability = req.query.capability;
  let rows;

  if (capability) {
    // SQLite JSON search — capabilities is stored as JSON array
    const stmt = db.prepare(
      `SELECT * FROM agents WHERE capabilities LIKE ? ORDER BY registered_at DESC`
    );
    rows = stmt.all(`%"${capability}"%`);
  } else {
    rows = getAllAgents.all();
  }

  res.json(rows.map(formatAgent));
});

// GET /agents/:id
app.get('/agents/:id', (req, res) => {
  const row = getAgentById.get(req.params.id);
  if (!row) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  res.json(formatAgent(row));
});

// POST /agents
app.post('/agents', (req, res) => {
  const { endpointUrl, capabilities, priceUsdc, stellarAddress } = req.body;

  if (!endpointUrl || !capabilities || !priceUsdc || !stellarAddress) {
    return res.status(400).json({
      error: 'Missing required fields: endpointUrl, capabilities, priceUsdc, stellarAddress',
    });
  }

  const id = randomUUID();
  const registeredAt = new Date().toISOString();

  insertAgent.run(
    id,
    endpointUrl,
    JSON.stringify(capabilities),
    priceUsdc,
    stellarAddress,
    registeredAt
  );

  res.status(201).json(formatAgent({
    id,
    endpoint_url: endpointUrl,
    capabilities: JSON.stringify(capabilities),
    price_usdc: priceUsdc,
    stellar_address: stellarAddress,
    registered_at: registeredAt,
  }));
});

app.listen(PORT, () => {
  console.log(`[registry] listening on http://localhost:${PORT}`);
});
