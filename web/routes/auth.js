/**
 * Core Game Bot — Auth Routes
 * Discord OAuth2 login OR simple password fallback
 */

const express = require('express');
const router = express.Router();
const logger = require('../../utils/logger');

const DISCORD_API = 'https://discord.com/api/v10';

/**
 * GET /auth/login — Login handler
 */
router.get('/login', (req, res) => {
  const clientId = process.env.CLIENT_ID;
  const clientSecret = process.env.CLIENT_SECRET;

  // If no CLIENT_SECRET, use simple admin login
  if (!clientSecret) {
    return res.redirect('/login?mode=simple');
  }

  const redirectUri = encodeURIComponent(
    process.env.CALLBACK_URL || `http://localhost:${process.env.DASHBOARD_PORT || 3001}/auth/callback`
  );
  const scope = encodeURIComponent('identify guilds');
  const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}`;
  res.redirect(authUrl);
});

/**
 * POST /auth/simple-login — Simple password login (no OAuth2 needed)
 */
router.post('/simple-login', (req, res) => {
  const { password } = req.body;
  const adminPassword = process.env.ADMIN_PASSWORD || 'coregame2024';

  if (password === adminPassword) {
    req.session.user = {
      id: 'admin',
      username: 'Admin',
      displayName: 'Dashboard Admin',
      avatar: '',
      guilds: req.botClient.guilds.cache.map(g => ({
        id: g.id,
        name: g.name,
        icon: g.iconURL({ dynamic: true, size: 128 }),
      })),
      isAdmin: true,
    };
    logger.info('Dashboard login via simple password');
    return res.json({ success: true });
  }

  res.status(401).json({ error: 'Invalid password' });
});

/**
 * GET /auth/callback — Discord OAuth2 callback
 */
router.get('/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect('/login?error=no_code');

  try {
    const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.CALLBACK_URL || `http://localhost:${process.env.DASHBOARD_PORT || 3001}/auth/callback`,
        scope: 'identify guilds',
      }),
    });

    if (!tokenRes.ok) {
      logger.error(`OAuth2 token exchange failed: ${tokenRes.status}`);
      return res.redirect('/login?error=token_failed');
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    const userRes = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!userRes.ok) return res.redirect('/login?error=user_fetch_failed');
    const user = await userRes.json();

    const guildsRes = await fetch(`${DISCORD_API}/users/@me/guilds`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    let guilds = [];
    let isAdmin = false;

    if (guildsRes.ok) {
      guilds = await guildsRes.json();
      const botGuildIds = req.botClient.guilds.cache.map(g => g.id);
      const adminGuilds = guilds.filter(g => {
        const perms = BigInt(g.permissions);
        return botGuildIds.includes(g.id) && (perms & BigInt(0x8)) === BigInt(0x8);
      });
      isAdmin = adminGuilds.length > 0;
      guilds = adminGuilds.map(g => ({ id: g.id, name: g.name, icon: g.icon }));
    }

    if (!isAdmin) return res.redirect('/login?error=not_admin');

    req.session.user = {
      id: user.id,
      username: user.username,
      displayName: user.global_name || user.username,
      avatar: user.avatar
        ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
        : `https://cdn.discordapp.com/embed/avatars/0.png`,
      guilds,
      isAdmin,
      accessToken,
    };

    logger.info(`Dashboard login: ${user.username} (${user.id})`);
    res.redirect('/dashboard');

  } catch (error) {
    logger.error(`OAuth2 callback error: ${error.message}`);
    res.redirect('/login?error=server_error');
  }
});

/**
 * GET /auth/logout
 */
router.get('/logout', (req, res) => {
  if (req.session.user) {
    logger.info(`Dashboard logout: ${req.session.user.username}`);
  }
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

module.exports = router;
