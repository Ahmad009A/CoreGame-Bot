/**
 * Core Game Bot — /xo Command
 * Tic-Tac-Toe game — 10 rounds, both players in same voice
 * 
 * FIX: Uses interactionCreate-level handling via activeGames Map export
 * instead of component collectors (which conflict with the global handler)
 */

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const colors = require('../../config/colors');

const activeGames = new Map();

const EMPTY = '⬛';
const X = '❌';
const O = '⭕';

function createBoard() {
  return Array(9).fill(EMPTY);
}

function createButtons(board, gameId, disabled = false) {
  const rows = [];
  for (let r = 0; r < 3; r++) {
    const row = new ActionRowBuilder();
    for (let c = 0; c < 3; c++) {
      const idx = r * 3 + c;
      const cell = board[idx];
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`xo_${gameId}_${idx}`)
          .setLabel(cell === EMPTY ? '‎' : cell === X ? 'X' : 'O')
          .setStyle(cell === X ? ButtonStyle.Danger : cell === O ? ButtonStyle.Primary : ButtonStyle.Secondary)
          .setDisabled(disabled || cell !== EMPTY)
      );
    }
    rows.push(row);
  }
  return rows;
}

function checkWin(board, symbol) {
  const wins = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6],
  ];
  return wins.some(([a, b, c]) => board[a] === symbol && board[b] === symbol && board[c] === symbol);
}

function isBoardFull(board) {
  return board.every(c => c !== EMPTY);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('xo')
    .setDescription('Play Tic-Tac-Toe — یاری XO (10 rounds)')
    .addUserOption(opt =>
      opt.setName('opponent')
        .setDescription('Select your opponent — ڕکابەرەکەت هەڵبژێرە')
        .setRequired(true)
    ),

  // Export for interactionCreate handler
  activeGames,
  handleXOButton,

  async execute(interaction) {
    const challenger = interaction.member;
    const opponentUser = interaction.options.getUser('opponent');
    const opponent = await interaction.guild.members.fetch(opponentUser.id).catch(() => null);

    if (!opponent) {
      return interaction.reply({
        embeds: [new EmbedBuilder().setDescription('❌ User not found!').setColor(colors.ERROR)],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (opponentUser.id === interaction.user.id) {
      return interaction.reply({
        embeds: [new EmbedBuilder().setDescription('❌ You cannot play against yourself!').setColor(colors.ERROR)],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (opponentUser.bot) {
      return interaction.reply({
        embeds: [new EmbedBuilder().setDescription('❌ You cannot play against a bot!').setColor(colors.ERROR)],
        flags: MessageFlags.Ephemeral,
      });
    }

    // Check both in same voice
    const challVoice = challenger.voice?.channel;
    const oppVoice = opponent.voice?.channel;

    if (!challVoice || !oppVoice || challVoice.id !== oppVoice.id) {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setDescription('❌ Both players must be in the **same voice channel**!\n\nهەردوو یاریزان دەبێت لە هەمان ڤۆیس بن!')
          .setColor(colors.ERROR)],
        flags: MessageFlags.Ephemeral,
      });
    }

    const gameId = `${interaction.user.id}_${Date.now()}`;
    const game = {
      id: gameId,
      players: [interaction.user.id, opponentUser.id],
      names: [interaction.user.displayName, opponentUser.displayName],
      symbols: [X, O],
      board: createBoard(),
      turn: 0,
      round: 1,
      maxRounds: 10,
      scores: [0, 0],
      channelId: interaction.channel.id,
      createdAt: Date.now(),
    };

    activeGames.set(gameId, game);

    // Auto-cleanup after 5 min
    setTimeout(() => { activeGames.delete(gameId); }, 300_000);

    const embed = new EmbedBuilder()
      .setTitle('🕹️ Tic-Tac-Toe — Round 1/10')
      .setDescription([
        `${X} **${game.names[0]}** vs ${O} **${game.names[1]}**`,
        `Score: **${game.scores[0]}** - **${game.scores[1]}**`,
        '',
        `${game.symbols[game.turn]} <@${game.players[game.turn]}>'s turn`,
      ].join('\n'))
      .setColor(colors.ACCENT);

    await interaction.reply({
      embeds: [embed],
      components: createButtons(game.board, gameId),
    });
  },
};

/**
 * Handle XO button clicks — called from interactionCreate
 * This avoids collector conflicts with the global handler
 */
async function handleXOButton(interaction) {
  const parts = interaction.customId.split('_');
  // Format: xo_<USERID>_<TIMESTAMP>_<CELL>
  // gameId = parts[1] + '_' + parts[2], cell = parts[3]
  const gameId = `${parts[1]}_${parts[2]}`;
  const cell = parseInt(parts[3]);

  const g = activeGames.get(gameId);
  if (!g) {
    return interaction.deferUpdate().catch(() => {});
  }

  // Check it's the correct player's turn
  if (interaction.user.id !== g.players[g.turn]) {
    return interaction.reply({
      content: '❌ Not your turn! — نۆرەی تۆ نیە!',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (g.board[cell] !== EMPTY) {
    return interaction.deferUpdate().catch(() => {});
  }

  // Place symbol
  g.board[cell] = g.symbols[g.turn];
  const currentSymbol = g.symbols[g.turn];
  const currentPlayer = g.turn;

  // ── Check win ──
  if (checkWin(g.board, currentSymbol)) {
    g.scores[currentPlayer]++;

    if (g.round >= g.maxRounds) {
      // Game over!
      const winner = g.scores[0] > g.scores[1] ? 0 : g.scores[1] > g.scores[0] ? 1 : -1;
      const embed = new EmbedBuilder()
        .setTitle('🏆 Game Over!')
        .setDescription([
          `${X} **${g.names[0]}** (${g.scores[0]}) vs ${O} **${g.names[1]}** (${g.scores[1]})`,
          '',
          winner === -1 ? '🤝 **It\'s a TIE!**' : `🎉 **${g.names[winner]}** WINS the match!`,
        ].join('\n'))
        .setColor(winner === -1 ? colors.INFO : colors.GOLD);

      activeGames.delete(gameId);
      return interaction.update({ embeds: [embed], components: createButtons(g.board, gameId, true) });
    }

    // Next round
    g.round++;
    g.board = createBoard();
    g.turn = g.round % 2;

    const embed = new EmbedBuilder()
      .setTitle(`🕹️ Tic-Tac-Toe — Round ${g.round}/${g.maxRounds}`)
      .setDescription([
        `${X} **${g.names[0]}** (${g.scores[0]}) vs ${O} **${g.names[1]}** (${g.scores[1]})`,
        '',
        `🎉 **${g.names[currentPlayer]}** wins Round ${g.round - 1}!`,
        '',
        `${g.symbols[g.turn]} <@${g.players[g.turn]}>'s turn`,
      ].join('\n'))
      .setColor(colors.ACCENT);

    return interaction.update({ embeds: [embed], components: createButtons(g.board, gameId) });
  }

  // ── Check draw ──
  if (isBoardFull(g.board)) {
    if (g.round >= g.maxRounds) {
      const winner = g.scores[0] > g.scores[1] ? 0 : g.scores[1] > g.scores[0] ? 1 : -1;
      const embed = new EmbedBuilder()
        .setTitle('🏆 Game Over!')
        .setDescription([
          `${X} **${g.names[0]}** (${g.scores[0]}) vs ${O} **${g.names[1]}** (${g.scores[1]})`,
          '',
          `Draw this round!`,
          winner === -1 ? '🤝 **TIE!**' : `🎉 **${g.names[winner]}** WINS!`,
        ].join('\n'))
        .setColor(colors.GOLD);

      activeGames.delete(gameId);
      return interaction.update({ embeds: [embed], components: createButtons(g.board, gameId, true) });
    }

    g.round++;
    g.board = createBoard();
    g.turn = g.round % 2;

    const embed = new EmbedBuilder()
      .setTitle(`🕹️ Tic-Tac-Toe — Round ${g.round}/${g.maxRounds}`)
      .setDescription([
        `${X} **${g.names[0]}** (${g.scores[0]}) vs ${O} **${g.names[1]}** (${g.scores[1]})`,
        '',
        `🤝 Round ${g.round - 1} was a **draw**!`,
        '',
        `${g.symbols[g.turn]} <@${g.players[g.turn]}>'s turn`,
      ].join('\n'))
      .setColor(colors.ACCENT);

    return interaction.update({ embeds: [embed], components: createButtons(g.board, gameId) });
  }

  // ── Next turn ──
  g.turn = 1 - g.turn;

  const embed = new EmbedBuilder()
    .setTitle(`🕹️ Tic-Tac-Toe — Round ${g.round}/${g.maxRounds}`)
    .setDescription([
      `${X} **${g.names[0]}** (${g.scores[0]}) vs ${O} **${g.names[1]}** (${g.scores[1]})`,
      '',
      `${g.symbols[g.turn]} <@${g.players[g.turn]}>'s turn`,
    ].join('\n'))
    .setColor(colors.ACCENT);

  await interaction.update({ embeds: [embed], components: createButtons(g.board, gameId) });
}
