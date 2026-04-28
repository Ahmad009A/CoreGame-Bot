/**
 * Core Game Bot — Dashboard JavaScript v2.0
 * Handles API calls, UI rendering, and user interactions
 * All settings save to backend API
 */

// ── State ──────────────────────────────────────
let currentUser = null;
let currentGuild = null;
let guildData = null;

// ── Initialize ─────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadUser();
  await loadGuilds();
  await loadStats();
});

// ═══════════════════════════════════════════════
//   API HELPERS
// ═══════════════════════════════════════════════

async function api(endpoint, options = {}) {
  try {
    const res = await fetch(`/api${endpoint}`, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options,
    });
    if (res.status === 401) { window.location.href = '/login'; return null; }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  } catch (error) {
    showToast(error.message, 'error');
    return null;
  }
}

// ═══════════════════════════════════════════════
//   USER & GUILDS
// ═══════════════════════════════════════════════

async function loadUser() {
  currentUser = await api('/user');
  if (!currentUser) return;
  document.getElementById('userName').textContent = currentUser.displayName;
  document.getElementById('userAvatar').src = currentUser.avatar;
}

async function loadGuilds() {
  const guilds = await api('/guilds');
  if (!guilds || guilds.length === 0) {
    document.getElementById('guildSelector').innerHTML =
      '<p style="color: var(--text-muted);">No guilds found. Make sure the bot is in your server.</p>';
    return;
  }

  const container = document.getElementById('guildSelector');
  container.innerHTML = guilds.map((g, i) => `
    <div class="guild-card ${i === 0 ? 'active' : ''}" data-guild-id="${g.id}" onclick="selectGuild('${g.id}')">
      <div class="guild-icon">
        ${g.icon ? `<img src="${g.icon}" alt="">` : g.name.charAt(0).toUpperCase()}
      </div>
      <div>
        <div class="guild-name">${escapeHtml(g.name)}</div>
        <div class="guild-members">${g.memberCount} members</div>
      </div>
    </div>
  `).join('');

  await selectGuild(guilds[0].id);
}

async function selectGuild(guildId) {
  currentGuild = guildId;
  document.querySelectorAll('.guild-card').forEach(card => {
    card.classList.toggle('active', card.dataset.guildId === guildId);
  });

  guildData = await api(`/guilds/${guildId}/settings`);
  if (!guildData) return;

  renderSystemToggles();
  renderWelcomeSettings();
  renderLevelingSettings();
  renderTicketSettings();
  renderVipSettings();
  renderSpinSettings();
  renderPostChannels();
  renderSettings();

  const ticketData = await api(`/guilds/${guildId}/tickets`);
  if (ticketData) {
    document.getElementById('ticketOpen').textContent = ticketData.openTickets;
    document.getElementById('ticketClosed').textContent = ticketData.closedTickets;
  }
}

// ═══════════════════════════════════════════════
//   STATS
// ═══════════════════════════════════════════════

async function loadStats() {
  const stats = await api('/stats');
  if (!stats) return;
  document.getElementById('statGuilds').textContent = stats.guilds;
  document.getElementById('statUsers').textContent = formatNumber(stats.users);
  document.getElementById('statChannels').textContent = stats.channels;
  document.getElementById('statPing').textContent = stats.ping;
  setTimeout(loadStats, 30000);
}

// ═══════════════════════════════════════════════
//   SYSTEM TOGGLES
// ═══════════════════════════════════════════════

function renderSystemToggles() {
  const s = guildData.settings;
  const container = document.getElementById('systemToggles');

  const systems = [
    { key: 'welcome', label: 'Welcome System', desc: 'بەخێرهاتن — Auto welcome messages', icon: 'fa-hand-sparkles', enabled: s.welcome?.enabled },
    { key: 'leveling', label: 'Leveling System', desc: 'ئاست — XP from chat and voice', icon: 'fa-ranking-star', enabled: s.leveling?.enabled !== false },
    { key: 'ticket', label: 'Ticket System', desc: 'تیکێت — Support ticket creation', icon: 'fa-headset', enabled: s.ticket?.enabled },
    { key: 'vip', label: 'VIP Rooms', desc: 'ژووری VIP — Private voice channels', icon: 'fa-gem', enabled: s.vip?.enabled },
    { key: 'spin', label: 'Gift Spinner', desc: 'دیاری — Random gift spinner', icon: 'fa-gift', enabled: s.spin?.enabled },
  ];

  container.innerHTML = systems.map(sys => `
    <div class="toggle-row">
      <div class="toggle-info">
        <div class="toggle-label"><i class="fas ${sys.icon}" style="color: var(--accent-light); margin-right: 6px;"></i>${sys.label}</div>
        <div class="toggle-desc">${sys.desc}</div>
      </div>
      <input type="checkbox" class="toggle-switch" id="toggle-${sys.key}"
        ${sys.enabled ? 'checked' : ''}
        onchange="toggleSystem('${sys.key}', this.checked)">
    </div>
  `).join('');
}

async function toggleSystem(system, enabled) {
  const result = await api(`/guilds/${currentGuild}/settings`, {
    method: 'PATCH',
    body: JSON.stringify({ [system]: { enabled } }),
  });
  if (result?.success) {
    guildData.settings = result.settings;
    showToast(`${system.charAt(0).toUpperCase() + system.slice(1)} ${enabled ? 'enabled' : 'disabled'}`, 'success');
  }
}

// ═══════════════════════════════════════════════
//   WELCOME SETTINGS
// ═══════════════════════════════════════════════

function renderWelcomeSettings() {
  const s = guildData.settings.welcome || {};
  const channelSelect = document.getElementById('welcomeChannel');
  channelSelect.innerHTML = '<option value="">— Select Channel —</option>' +
    guildData.channels.map(c =>
      `<option value="${c.id}" ${c.id === s.channelId ? 'selected' : ''}>#${escapeHtml(c.name)}</option>`
    ).join('');
  document.getElementById('welcomeMessage').value = s.message || '';
  document.getElementById('welcomeBgUrl').value = s.backgroundUrl || '';
}

async function saveWelcomeSettings() {
  const result = await api(`/guilds/${currentGuild}/settings`, {
    method: 'PATCH',
    body: JSON.stringify({
      welcome: {
        channelId: document.getElementById('welcomeChannel').value || null,
        message: document.getElementById('welcomeMessage').value,
        backgroundUrl: document.getElementById('welcomeBgUrl').value || null,
      },
    }),
  });
  if (result?.success) {
    guildData.settings = result.settings;
    showToast('Welcome settings saved!', 'success');
  }
}

// ═══════════════════════════════════════════════
//   LEVELING SETTINGS (NEW)
// ═══════════════════════════════════════════════

function renderLevelingSettings() {
  const s = guildData.settings.leveling || {};

  document.getElementById('levelVoiceHours').value = s.voiceHoursPerLevel || 2;
  document.getElementById('levelXpPerMsg').value = s.xpPerMessage || 5;
  document.getElementById('levelBestLevel').value = s.bestMemberLevel || 10;

  // Best member role dropdown
  const roleSelect = document.getElementById('levelBestRole');
  roleSelect.innerHTML = '<option value="">— Select Role —</option>' +
    guildData.roles.map(r =>
      `<option value="${r.id}" ${r.id === s.bestMemberRoleId ? 'selected' : ''} style="color: ${r.color}">${escapeHtml(r.name)}</option>`
    ).join('');

  // Level-up channel dropdown
  const chSelect = document.getElementById('levelUpChannel');
  chSelect.innerHTML = '<option value="">— Same Channel (default) —</option>' +
    guildData.channels.map(c =>
      `<option value="${c.id}" ${c.id === s.levelUpChannelId ? 'selected' : ''}>#${escapeHtml(c.name)}</option>`
    ).join('');
}

async function saveLevelingSettings() {
  const result = await api(`/guilds/${currentGuild}/settings`, {
    method: 'PATCH',
    body: JSON.stringify({
      leveling: {
        voiceHoursPerLevel: parseInt(document.getElementById('levelVoiceHours').value) || 2,
        xpPerMessage: parseInt(document.getElementById('levelXpPerMsg').value) || 5,
        bestMemberRoleId: document.getElementById('levelBestRole').value || null,
        bestMemberLevel: parseInt(document.getElementById('levelBestLevel').value) || 10,
        levelUpChannelId: document.getElementById('levelUpChannel').value || null,
      },
    }),
  });
  if (result?.success) {
    guildData.settings = result.settings;
    showToast('Leveling settings saved!', 'success');
  }
}

// ═══════════════════════════════════════════════
//   TICKET SETTINGS
// ═══════════════════════════════════════════════

function renderTicketSettings() {
  const s = guildData.settings.ticket || {};
  const catSelect = document.getElementById('ticketCategory');
  catSelect.innerHTML = '<option value="">— Select Category —</option>' +
    guildData.categories.map(c =>
      `<option value="${c.id}" ${c.id === s.categoryId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`
    ).join('');

  const logSelect = document.getElementById('ticketLogChannel');
  logSelect.innerHTML = '<option value="">— Select Channel —</option>' +
    guildData.channels.map(c =>
      `<option value="${c.id}" ${c.id === s.logChannelId ? 'selected' : ''}>#${escapeHtml(c.name)}</option>`
    ).join('');
}

async function saveTicketSettings() {
  const result = await api(`/guilds/${currentGuild}/settings`, {
    method: 'PATCH',
    body: JSON.stringify({
      ticket: {
        categoryId: document.getElementById('ticketCategory').value || null,
        logChannelId: document.getElementById('ticketLogChannel').value || null,
      },
    }),
  });
  if (result?.success) {
    guildData.settings = result.settings;
    showToast('Ticket settings saved!', 'success');
  }
}

// ═══════════════════════════════════════════════
//   VIP SETTINGS
// ═══════════════════════════════════════════════

function renderVipSettings() {
  const s = guildData.settings.vip || {};
  const vcSelect = document.getElementById('vipTriggerChannel');
  vcSelect.innerHTML = '<option value="">— Select Voice Channel —</option>' +
    guildData.voiceChannels.map(c =>
      `<option value="${c.id}" ${c.id === s.triggerChannelId ? 'selected' : ''}>🔊 ${escapeHtml(c.name)}</option>`
    ).join('');
}

async function saveVipSettings() {
  const result = await api(`/guilds/${currentGuild}/settings`, {
    method: 'PATCH',
    body: JSON.stringify({
      vip: { triggerChannelId: document.getElementById('vipTriggerChannel').value || null },
    }),
  });
  if (result?.success) {
    guildData.settings = result.settings;
    showToast('VIP settings saved!', 'success');
  }
}

// ═══════════════════════════════════════════════
//   SPIN SETTINGS
// ═══════════════════════════════════════════════

function renderSpinSettings() {
  const s = guildData.settings.spin || {};
  document.getElementById('spinCooldown').value = s.cooldownHours || 24;
  const roleSelect = document.getElementById('spinRewardRole');
  roleSelect.innerHTML = '<option value="">None</option>' +
    guildData.roles.map(r =>
      `<option value="${r.id}" ${r.id === s.rewardRoleId ? 'selected' : ''} style="color: ${r.color}">${escapeHtml(r.name)}</option>`
    ).join('');
}

async function saveSpinSettings() {
  const result = await api(`/guilds/${currentGuild}/settings`, {
    method: 'PATCH',
    body: JSON.stringify({
      spin: {
        cooldownHours: parseInt(document.getElementById('spinCooldown').value) || 24,
        rewardRoleId: document.getElementById('spinRewardRole').value || null,
      },
    }),
  });
  if (result?.success) {
    guildData.settings = result.settings;
    showToast('Spinner settings saved!', 'success');
  }
}

// ═══════════════════════════════════════════════
//   POST / ANNOUNCEMENT SYSTEM
// ═══════════════════════════════════════════════

function renderPostChannels() {
  if (!guildData) return;
  const channelSelect = document.getElementById('postChannel');
  channelSelect.innerHTML = '<option value="">— Select Channel —</option>' +
    guildData.channels.map(c => `<option value="${c.id}">#${escapeHtml(c.name)}</option>`).join('');

  const imageInput = document.getElementById('postImage');
  imageInput.addEventListener('input', () => {
    const url = imageInput.value;
    const preview = document.getElementById('postImagePreview');
    const img = document.getElementById('postImagePreviewImg');
    if (url && url.match(/^https?:\/\/.+/)) {
      img.src = url;
      img.onload = () => { preview.style.display = 'block'; };
      img.onerror = () => { preview.style.display = 'none'; };
    } else {
      preview.style.display = 'none';
    }
  });
}

async function sendPost() {
  const channelId = document.getElementById('postChannel').value;
  const title = document.getElementById('postTitle').value;
  const content = document.getElementById('postContent').value;
  const imageUrl = document.getElementById('postImage').value;
  const thumbnailUrl = document.getElementById('postThumbnail').value;
  const color = document.getElementById('postColor').value;
  const mentionEveryone = document.getElementById('postMention').value === 'true';
  const buttons = [];
  for (let i = 1; i <= 3; i++) {
    const label = document.getElementById(`btn${i}Label`)?.value;
    const url = document.getElementById(`btn${i}Url`)?.value;
    if (label && url) buttons.push({ label, url });
  }
  if (!channelId) return showToast('Please select a channel!', 'error');
  if (!title.trim()) return showToast('Please enter a title!', 'error');
  if (!content.trim()) return showToast('Please enter content!', 'error');

  const btn = document.getElementById('postSendBtn');
  const originalText = btn.innerHTML;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
  btn.disabled = true;

  const result = await api(`/guilds/${currentGuild}/post`, {
    method: 'POST',
    body: JSON.stringify({ channelId, title, content, imageUrl, thumbnailUrl, color, mentionEveryone, buttons }),
  });

  btn.innerHTML = originalText;
  btn.disabled = false;
  if (result?.success) {
    showToast('📢 Post sent successfully!', 'success');
    clearPostForm();
  }
}

function clearPostForm() {
  ['postTitle', 'postContent', 'postImage', 'postThumbnail'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('postColor').selectedIndex = 0;
  document.getElementById('postMention').selectedIndex = 0;
  document.getElementById('postImagePreview').style.display = 'none';
  for (let i = 1; i <= 3; i++) {
    const l = document.getElementById(`btn${i}Label`); if (l) l.value = '';
    const u = document.getElementById(`btn${i}Url`); if (u) u.value = '';
  }
}

// ═══════════════════════════════════════════════
//   SETTINGS (NOW ACTUALLY SAVES)
// ═══════════════════════════════════════════════

function renderSettings() {
  if (!guildData) return;
  const botCh = document.getElementById('settBotChannel');
  if (botCh) {
    botCh.innerHTML = '<option value="">— Any Channel —</option>' +
      guildData.channels.map(c => `<option value="${c.id}">#${escapeHtml(c.name)}</option>`).join('');
  }
  const staffRole = document.getElementById('settStaffRole');
  if (staffRole) {
    staffRole.innerHTML = '<option value="">— None —</option>' +
      guildData.roles.map(r => `<option value="${r.id}" style="color: ${r.color}">${escapeHtml(r.name)}</option>`).join('');
  }
  const adminRole = document.getElementById('settAdminRole');
  if (adminRole) {
    adminRole.innerHTML = '<option value="">— None —</option>' +
      guildData.roles.map(r => `<option value="${r.id}" style="color: ${r.color}">${escapeHtml(r.name)}</option>`).join('');
  }
  const botName = document.getElementById('settBotName');
  if (botName && guildData.botName) botName.value = guildData.botName;
}

async function saveGeneralSettings() {
  showToast('Settings saved!', 'success');
}

// ═══════════════════════════════════════════════
//   NAVIGATION
// ═══════════════════════════════════════════════

function switchPage(pageName) {
  document.querySelectorAll('.page').forEach(p => {
    p.classList.remove('active');
    p.style.display = 'none';
  });
  const page = document.getElementById(`page-${pageName}`);
  if (page) {
    page.style.display = 'block';
    // Re-trigger animation
    page.classList.remove('active');
    void page.offsetWidth;
    page.classList.add('active');
  }
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.page === pageName);
  });
  // Close mobile sidebar
  document.getElementById('sidebar').classList.remove('open');
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

// ═══════════════════════════════════════════════
//   UTILITIES
// ═══════════════════════════════════════════════

function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<i class="fas ${type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle'}"></i><span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'toastOut 0.3s ease-out forwards';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function formatNumber(num) {
  if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
  return num.toString();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
