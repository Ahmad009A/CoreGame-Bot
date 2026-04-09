/**
 * Core Game Bot — Ticket Model
 * Stores ticket data and transcript history
 * Falls back gracefully when MongoDB is not connected
 */

const mongoose = require('mongoose');

const ticketSchema = new mongoose.Schema({
  guildId: { type: String, required: true, index: true },
  channelId: { type: String, required: true, unique: true },
  userId: { type: String, required: true },
  ticketNumber: { type: Number, required: true },
  category: { type: String, default: 'General' },
  status: {
    type: String,
    enum: ['open', 'closed'],
    default: 'open',
  },
  transcript: [{
    authorTag: String,
    authorId: String,
    content: String,
    timestamp: { type: Date, default: Date.now },
    attachments: [String],
  }],
  closedAt: { type: Date, default: null },
  closedBy: { type: String, default: null },
}, {
  timestamps: true,
});

const TicketModel = mongoose.model('Ticket', ticketSchema);

// ── Wrapper that handles no-DB gracefully ────────
const Ticket = {
  findOne: async (query) => {
    if (mongoose.connection.readyState !== 1) return null;
    try { return await TicketModel.findOne(query); } catch { return null; }
  },
  find: async (query) => {
    if (mongoose.connection.readyState !== 1) return { sort: () => ({ limit: () => ({ select: () => [] }) }) };
    try {
      return await TicketModel.find(query);
    } catch { return { sort: () => ({ limit: () => ({ select: () => [] }) }) }; }
  },
  countDocuments: async (query) => {
    if (mongoose.connection.readyState !== 1) return 0;
    try { return await TicketModel.countDocuments(query); } catch { return 0; }
  },
  create: async (data) => {
    if (mongoose.connection.readyState !== 1) return { ...data, save: async () => {} };
    try { return await TicketModel.create(data); } catch { return { ...data, save: async () => {} }; }
  },
};

module.exports = Ticket;
