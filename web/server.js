/**
 * Core Game Bot — Express Web Server
 * Serves the admin dashboard with Discord OAuth2 authentication
 */

const express = require('express');
const session = require('express-session');
const path = require('path');
const logger = require('../utils/logger');
const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');
const { requireAuth } = require('./middleware/auth');

/**
 * Start the web dashboard server
 * @param {import('discord.js').Client} client - The Discord bot client
 */
function startDashboard(client) {
  const app = express();
  const PORT = process.env.DASHBOARD_PORT || 3000;

  // ── Middleware ──────────────────────────────
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.use(session({
    secret: process.env.SESSION_SECRET || 'coregame-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24, // 24 hours
      httpOnly: true,
      secure: false, // Set to true if using HTTPS
    },
  }));

  // Make client available to routes
  app.use((req, res, next) => {
    req.botClient = client;
    next();
  });

  // ── Static Files ───────────────────────────
  app.use(express.static(path.join(__dirname, 'public')));

  // ── Routes ─────────────────────────────────
  app.use('/auth', authRoutes);
  app.use('/api', requireAuth, apiRoutes);

  // Login page
  app.get('/login', (req, res) => {
    if (req.session.user) return res.redirect('/dashboard');
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
  });

  // Dashboard (protected)
  app.get('/dashboard', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
  });

  // Root redirect
  app.get('/', (req, res) => {
    if (req.session.user) return res.redirect('/dashboard');
    res.redirect('/login');
  });

  // API: Get current user info
  app.get('/api/user', requireAuth, (req, res) => {
    res.json(req.session.user);
  });

  // API: Get bot stats
  app.get('/api/stats', requireAuth, (req, res) => {
    res.json({
      guilds: client.guilds.cache.size,
      users: client.guilds.cache.reduce((a, g) => a + g.memberCount, 0),
      channels: client.channels.cache.size,
      uptime: client.uptime,
      ping: client.ws.ping,
    });
  });

  // ── Start Server ───────────────────────────
  app.listen(PORT, () => {
    logger.info(`🌐 Dashboard running at http://localhost:${PORT}`);
  });

  return app;
}

module.exports = { startDashboard };
