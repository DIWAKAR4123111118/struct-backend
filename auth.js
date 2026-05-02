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
        return res.json({ token });
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Signup error:', e);
        return res.status(500).json({ error: 'Signup failed' });
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('Signup outer error:', err);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  async function login(req, res) {
    try {
      console.log('[/auth/login] body:', req.body);

      const { email, password } = req.body;

      if (!email || !password) {
        console.log('[/auth/login] missing email or password');
        return res.status(400).json({ error: 'Missing credentials' });
      }

      const userRes = await pool.query(
        'SELECT * FROM users WHERE email=$1',
        [email]
      );
      console.log('[/auth/login] userRes.rowCount:', userRes.rowCount);

      if (userRes.rowCount === 0) {
        console.log('[/auth/login] no user for email:', email);
        return res.status(400).json({ error: 'Invalid credentials' });
      }

      const user = userRes.rows[0];
      console.log('[/auth/login] user:', {
        id: user.id,
        contractor_id: user.contractor_id,
        role: user.role,
        hasPasswordHash: !!user.password_hash,
      });

      if (!user.password_hash) {
        console.error('[/auth/login] user.password_hash is null/undefined');
        return res.status(500).json({ error: 'Server error' });
      }

      const match = await bcrypt.compare(password, user.password_hash);
      console.log('[/auth/login] password match:', match);

      if (!match) {
        return res.status(400).json({ error: 'Invalid credentials' });
      }

      const token = jwt.sign(
        { userId: user.id, contractorId: user.contractor_id, role: user.role },
        JWT_SECRET,
        { expiresIn: '7d' }
      );
      console.log('[/auth/login] token created');

      return res.json({ token });
    } catch (err) {
      console.error('[/auth/login] ERROR:', err);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  return { signup, login };
}

module.exports = createAuthHandlers;