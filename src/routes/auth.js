const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const db = require('../db');
const { JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

const SignupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

router.post('/signup', async (req, res) => {
  const parsed = SignupSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid input', details: parsed.error.issues });
  }

  const { email, password } = parsed.data;
  const passwordHash = await bcrypt.hash(password, 10);

  try {
    const result = await db.query(`
      INSERT INTO tenants (email, password_hash, plan_id)
      VALUES ($1, $2, (SELECT id FROM plans WHERE name = 'free'))
      RETURNING id, email
    `, [email, passwordHash]);

    const tenant = result.rows[0];
    const token = jwt.sign({ tenantId: tenant.id, email: tenant.email }, JWT_SECRET, { expiresIn: '24h' });

    res.status(201).json({ tenant: { id: tenant.id, email: tenant.email }, token });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Email already registered' });
    }
    throw err;
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password required' });
  }

  const result = await db.query('SELECT * FROM tenants WHERE email = $1', [email]);
  const tenant = result.rows[0];

  if (!tenant) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const valid = await bcrypt.compare(password, tenant.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign({ tenantId: tenant.id, email: tenant.email }, JWT_SECRET, { expiresIn: '24h' });

  res.json({ token });
});

module.exports = router;