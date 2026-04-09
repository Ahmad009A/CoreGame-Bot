# 🎮 Core Game Bot — Setup Guide

## سەرەتا باشە! — Getting Started

### Prerequisites

- **Node.js** v18 or higher — [Download](https://nodejs.org/)
- **MongoDB** — Free cloud: [MongoDB Atlas](https://www.mongodb.com/atlas/database) or local install
- **Discord Bot Token** — [Discord Developer Portal](https://discord.com/developers/applications)

---

## Step 1: Configure Environment

Copy `.env.example` to `.env` and fill in your values:

```bash
copy .env.example .env
```

Edit `.env`:

```env
# ── Discord Bot Credentials ──────────────────
BOT_TOKEN=your_bot_token_here
CLIENT_ID=your_application_client_id
GUILD_ID=your_test_server_id

# ── Database ─────────────────────────────────
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/coregame

# ── Channel IDs ──────────────────────────────
WELCOME_CHANNEL_ID=your_welcome_channel_id
LOG_CHANNEL_ID=your_log_channel_id

# ── Role IDs ─────────────────────────────────
STAFF_ROLE_ID=your_staff_role_id
ADMIN_ROLE_ID=your_admin_role_id

# ── System Settings ──────────────────────────
BOT_USE_CHANNEL_NAME=bot-use
VIP_TRIGGER_CHANNEL_NAME=VIP Room
SPIN_COOLDOWN_HOURS=24
```

### Where to find IDs:
1. Enable **Developer Mode** in Discord: Settings → Advanced → Developer Mode
2. Right-click any channel/role/user → **Copy ID**

---

## Step 2: Install Dependencies

```bash
npm install
```

---

## Step 3: Deploy Slash Commands

```bash
npm run deploy
```

This registers all slash commands with Discord. For guild-specific (instant) deployment, make sure `GUILD_ID` is set.

---

## Step 4: Start the Bot

```bash
npm start
```

Or for development (auto-restart on changes):

```bash
npm run dev
```

---

## 🤖 Bot Intents Setup

In the [Discord Developer Portal](https://discord.com/developers/applications), enable these **Privileged Gateway Intents**:

1. **SERVER MEMBERS INTENT** — Required for welcome system
2. **MESSAGE CONTENT INTENT** — Required for ticket transcript

---

## 📋 Available Commands

### Admin Commands (Administrator only)
| Command | Description |
|---------|-------------|
| `/panel` | Open admin control panel with toggle buttons |
| `/setwelcome channel` | Set the welcome channel |
| `/setwelcome message` | Set welcome message template |
| `/setwelcome background` | Set custom welcome background image URL |
| `/setwelcome test` | Preview the welcome card |
| `/setup-ticket` | Deploy ticket creation panel in current channel |

### Fun Commands
| Command | Description |
|---------|-------------|
| `/spin` | Spin the gift wheel — random member wins! |

### Utility Commands
| Command | Description |
|---------|-------------|
| `/ping` | Check bot latency |
| `/help` | View all commands |

---

## 🎫 Ticket System Setup

1. Run `/setup-ticket` in the channel where you want the ticket panel
2. Optionally specify a category and log channel:
   ```
   /setup-ticket category:#Tickets log-channel:#ticket-logs
   ```
3. Users click the "🎫 Create Ticket" button to open tickets
4. Tickets are private channels visible only to the user + staff role
5. Transcripts are saved to DB and sent to the log channel on close

---

## 👑 VIP Room System

1. Create a voice channel named **"VIP Room"** (or whatever `VIP_TRIGGER_CHANNEL_NAME` is set to)
2. When a user joins that channel:
   - Bot creates a private voice channel named after them
   - User gets full control (rename, user limit, kick)
   - Channel auto-deletes when empty

---

## 🎨 Custom Welcome Background

Upload your own welcome card background:

```
/setwelcome background url:https://example.com/your-image.png
```

- Supported formats: PNG, JPG, JPEG, WebP, GIF
- Recommended size: 1024x450px
- A dark overlay is auto-applied for text readability
- Test it with `/setwelcome test`

---

## 📁 Project Structure

```
coregame-bot/
├── index.js                    # Bot entry point
├── deploy-commands.js          # Slash command deployer
├── package.json
├── .env.example
├── .gitignore
│
├── config/
│   ├── colors.js               # Gaming color palette
│   ├── emojis.js               # Emoji constants
│   └── database.js             # MongoDB connection
│
├── models/
│   ├── GuildSettings.js        # Per-guild configuration
│   └── Ticket.js               # Ticket data + transcripts
│
├── handlers/
│   ├── commandHandler.js       # Slash command loader
│   └── eventHandler.js         # Event loader
│
├── events/
│   ├── ready.js                # Bot online event
│   ├── interactionCreate.js    # Command/button/menu router
│   ├── guildMemberAdd.js       # Welcome system
│   └── voiceStateUpdate.js     # VIP room system
│
├── commands/
│   ├── admin/
│   │   ├── panel.js            # Admin dashboard
│   │   ├── setwelcome.js       # Welcome configuration
│   │   └── setup-ticket.js     # Ticket panel setup
│   ├── fun/
│   │   └── spin.js             # Gift spinner
│   └── utility/
│       ├── ping.js             # Latency check
│       └── help.js             # Help command
│
├── utils/
│   ├── embeds.js               # Themed embed builders
│   ├── checkChannel.js         # bot-use channel restriction
│   ├── permissions.js          # Admin/staff checks
│   ├── logger.js               # Winston logging
│   └── welcomeCanvas.js        # Canvas image generator
│
└── logs/                       # Auto-created log files
```

---

## 🔧 Troubleshooting

| Issue | Solution |
|-------|----------|
| "Invalid token" | Check `BOT_TOKEN` in `.env` |
| Commands not showing | Run `npm run deploy` |
| Welcome not sending | Check `WELCOME_CHANNEL_ID` or use `/setwelcome channel` |
| Ticket permission error | Ensure bot has `Manage Channels` permission |
| VIP room not creating | Ensure bot has `Manage Channels` + `Move Members` |
| Kurdish text appears as boxes | Install Noto Sans Arabic or Tahoma font on host OS |
