require('dotenv').config({ path: './.env' });

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const createAuthHandlers = require('./auth');

const app = express();

app.use(cors());
app.use(express.json());

// ---------- DATABASE POOL (Railway friendly) ----------
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  // In production this must be set via Railway Variables
  throw new Error('DATABASE_URL is not set');
}

const pool = new Pool({
  connectionString,
  ssl: {
    rejectUnauthorized: false,
  },
});
// ------------------------------------------------------

const { signup, login } = createAuthHandlers(pool);

// ---------- Auth middleware ----------
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'No token' });

  const token = header.split(' ')[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}
// -------------------------------------

// Health
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false });
  }
});

// Auth
app.post('/auth/signup', signup);
app.post('/auth/login', login);

// Simple protected route to test token
app.get('/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

// ---------- Sites ----------
app.post('/sites', authMiddleware, async (req, res) => {
  const { name, address, project_type } = req.body;
  const { contractorId } = req.user;
  try {
    const result = await pool.query(
      'INSERT INTO sites(contractor_id,name,address,project_type) VALUES($1,$2,$3,$4) RETURNING *',
      [contractorId, name, address || null, project_type || null]
    );
    res.json(result.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create site' });
  }
});

app.get('/sites', authMiddleware, async (req, res) => {
  const { contractorId } = req.user;
  try {
    const result = await pool.query(
      'SELECT * FROM sites WHERE contractor_id=$1 ORDER BY created_at DESC',
      [contractorId]
    );
    res.json(result.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch sites' });
  }
});

// ---------- Activities ----------
app.post('/activities', authMiddleware, async (req, res) => {
  const { contractorId } = req.user;
  const { site_id, title, description, photo_url, location, trade, due_date } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO activities
       (contractor_id, site_id, title, description, photo_url, location, trade, due_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        contractorId,
        site_id,
        title,
        description || null,
        photo_url || null,
        location || null,
        trade || null,
        due_date || null,
      ]
    );
    res.json(result.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create activity' });
  }
});

app.get('/activities', authMiddleware, async (req, res) => {
  const { contractorId } = req.user;
  try {
    const result = await pool.query(
      `SELECT a.*, s.name AS site_name
       FROM activities a
       JOIN sites s ON a.site_id = s.id
       WHERE a.contractor_id=$1
       ORDER BY a.created_at DESC`,
      [contractorId]
    );
    res.json(result.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch activities' });
  }
});

app.get('/activities/:id', authMiddleware, async (req, res) => {
  const { contractorId } = req.user;
  const { id } = req.params;
  try {
    const activityRes = await pool.query(
      `SELECT * FROM activities WHERE id=$1 AND contractor_id=$2`,
      [id, contractorId]
    );
    if (activityRes.rowCount === 0) return res.status(404).json({ error: 'Not found' });

    const approvalsRes = await pool.query(
      `SELECT a.*, w.name AS worker_name
       FROM approvals a
       LEFT JOIN workers w ON a.approved_by_worker_id = w.id
       WHERE a.activity_id=$1`,
      [id]
    );
    const costRes = await pool.query(
      `SELECT * FROM costs WHERE activity_id=$1`,
      [id]
    );
    res.json({
      activity: activityRes.rows[0],
      approvals: approvalsRes.rows,
      cost: costRes.rows[0] || null,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch activity' });
  }
});

// ---------- PRINT ROUTE ----------
app.get('/activities/:id/print', authMiddleware, async (req, res) => {
  const { contractorId } = req.user;
  const { id } = req.params;

  try {
    const activityRes = await pool.query(
      `SELECT a.*, s.name AS site_name
       FROM activities a
       JOIN sites s ON a.site_id = s.id
       WHERE a.id=$1 AND a.contractor_id=$2`,
      [id, contractorId]
    );
    if (activityRes.rowCount === 0) return res.status(404).send('Not found');

    const approvalsRes = await pool.query(
      `SELECT * FROM approvals WHERE activity_id=$1`,
      [id]
    );
    const costRes = await pool.query(
      `SELECT * FROM costs WHERE activity_id=$1`,
      [id]
    );

    const a = activityRes.rows[0];
    const cost = costRes.rows[0];

    res.send(`
      <html>
      <head><title>Activity ${a.title}</title></head>
      <body>
        <h1>${a.title}</h1>
        <p><strong>Site:</strong> ${a.site_name}</p>
        <p><strong>Location:</strong> ${a.location || ''}</p>
        <p><strong>Trade:</strong> ${a.trade || ''}</p>
        <p><strong>Description:</strong> ${a.description || ''}</p>

        <h2>Approvals</h2>
        ${
          approvalsRes.rows
            .map(
              ap =>
                `<p>Approved at ${ap.created_at || ''} - ${ap.comment || ''}</p>`
            )
            .join('')
        }

        <h2>Cost & Profit</h2>
        ${
          cost
            ? `
          <p>Total cost: ₹${cost.total_cost}</p>
          <p>Revenue: ₹${cost.revenue}</p>
          <p>Profit: ₹${cost.profit}</p>
          <p>Profit %: ${cost.profit_percent}</p>
        `
            : '<p>No cost data</p>'
        }
      </body>
      </html>
    `);
  } catch (e) {
    console.error(e);
    res.status(500).send('Error');
  }
});
// ---------------------------

// ---------- Approvals ----------
app.post('/approvals', authMiddleware, async (req, res) => {
  const { activity_id, approved_by_worker_id, photo_url, comment } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO approvals(activity_id,approved_by_worker_id,photo_url,comment)
       VALUES($1,$2,$3,$4) RETURNING *`,
      [activity_id, approved_by_worker_id || null, photo_url || null, comment || null]
    );
    await pool.query(
      `UPDATE activities SET status='completed', updated_at=NOW() WHERE id=$1`,
      [activity_id]
    );
    res.json(result.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create approval' });
  }
});

// ---------- Costs ----------
app.post('/costs', authMiddleware, async (req, res) => {
  try {
    console.log('[/costs] body:', req.body);

    const {
      activity_id,
      labour_hours,
      labour_rate,
      material_amount,
      other_amount,
      revenue,
    } = req.body;

    if (!activity_id) {
      console.error('[/costs] missing activity_id');
      return res.status(400).json({ error: 'activity_id is required' });
    }

    const lh = Number(labour_hours) || 0;
    const lr = Number(labour_rate) || 0;
    const ma = Number(material_amount) || 0;
    const oa = Number(other_amount) || 0;
    const rv = Number(revenue) || 0;

    const labour_amount = lh * lr;
    const total_cost = labour_amount + ma + oa;
    const profit = rv - total_cost;
    const profit_percent = rv > 0 ? (profit / rv) * 100 : null;

    console.log('[/costs] calculated:', {
      activity_id,
      lh,
      lr,
      ma,
      oa,
      rv,
      labour_amount,
      total_cost,
      profit,
      profit_percent,
    });

    const result = await pool.query(
      `INSERT INTO costs(
         activity_id,
         labour_hours,
         labour_rate,
         labour_amount,
         material_amount,
         other_amount,
         total_cost,
         revenue,
         profit,
         profit_percent
       )
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [activity_id, lh, lr, labour_amount, ma, oa, total_cost, rv, profit, profit_percent]
    );

    console.log('[/costs] inserted row id:', result.rows[0]?.id);
    res.json(result.rows[0]);
  } catch (e) {
    console.error('[/costs] ERROR:', e);
    res.status(500).json({ error: 'Failed to save cost' });
  }
});

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});