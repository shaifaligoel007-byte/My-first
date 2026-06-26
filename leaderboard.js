const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /leaderboard?mode=race&limit=50
router.get('/', (req, res) => {
  const { mode = 'all', limit = 50 } = req.query;
  const board = db.getLeaderboard({ mode, limit: Math.min(Number(limit) || 50, 200) });
  res.json({ leaderboard: board, mode, count: board.length });
});

// GET /leaderboard/player/:playerId
router.get('/player/:playerId', (req, res) => {
  const { playerId } = req.params;
  const { limit = 20 } = req.query;
  const scores = db.getPlayerScores(playerId, { limit: Number(limit) || 20 });
  res.json({ scores, playerId });
});

module.exports = router;
