const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is not set');
}

function createAuthHandlers(pool) {
  async function signup(req, res) {
    try {
      const { contractorName, email, password, phone } = req.body;
      if (!contractorName || !email || !password) {
        return res.status(400).json({ error: 'Missing fields' });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const contractorRes = await client.query(
          'INSERT INTO contractors(name, phone, email) VALUES($1,$2,$3) RETURNING id',
          [contractorName, phone || null, email]
        );
        const contractorId = contractorRes.rows[0].id;

        const hash = await bcrypt.hash(password, 10);
        const userRes = await client.query(
          'INSERT INTO users(contractor_id,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id',
          [contractorId, email, hash, 'admin']
        );
        const userId = userRes.rows[0].id;

        await client.query('COMMIT');

        const token = jwt.sign(
          { userId, contractorId, role: 'admin' },
          JWT_SECRET,
          { expiresIn: '7d' }
        );
        res.json({ token });
      } catch (e) {
        await client.query('ROLLBACK');
        console.error(e);
        res.status(500).json({ error: 'Signup failed' });
      } finally {
        client.release();
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error' });
    }
  }

  async function login(req, res) {
    try {
      const { email, password } = req.body;

      const userRes = await pool.query(
        'SELECT * FROM users WHERE email=$1',
        [email]
      );
      if (userRes.rowCount === 0) {
        return res.status(400).json({ error: 'Invalid credentials' });
      }

      const user = userRes.rows[0];
      const match = await bcrypt.compare(password, user.password_hash);
      if (!match) {
        return res.status(400).json({ error: 'Invalid credentials' });
      }

      const token = jwt.sign(
        { userId: user.id, contractorId: user.contractor_id, role: user.role },
        JWT_SECRET,
        { expiresIn: '7d' }
      );
      res.json({ token });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error' });
    }
  }

  return { signup, login };
}

module.exports = createAuthHandlers;
