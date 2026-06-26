const express = require('express');
const router = express.Router();
const db = require('../db');

// POST /auth/register
router.post('/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  if (username.length < 2 || username.length > 20) return res.status(400).json({ error: 'Username must be 2–20 chars' });
  if (password.length < 4) return res.status(400).json({ error: 'Password too short (min 4 chars)' });

  const result = db.registerUser({ username: username.trim(), password });
  if (!result.ok) return res.status(409).json({ error: result.error });
  res.json({ token: result.token, player: result.player });
});

// POST /auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });

  const result = db.loginUser({ username: username.trim(), password });
  if (!result.ok) return res.status(401).json({ error: result.error });
  res.json({ token: result.token, player: result.player });
});

// GET /auth/me  (token in Authorization header)
router.get('/me', (req, res) => {
  const token = getBearerToken(req);
  const player = db.verifyToken(token);
  if (!player) return res.status(401).json({ error: 'Invalid token' });
  res.json({ player });
});

function getBearerToken(req) {
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : null;
}

module.exports = router;
