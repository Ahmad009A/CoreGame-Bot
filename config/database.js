/**
 * Core Game Bot — MongoDB Connection
 * Uses Mongoose with retry logic and event logging
 */

const mongoose = require('mongoose');
const logger = require('../utils/logger');

async function connectDatabase() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    logger.warn('MONGODB_URI not set — running without database. Some features will be unavailable.');
    return;
  }

  try {
    await mongoose.connect(uri, {
      // Mongoose 8 defaults are already optimal
    });

    logger.info('✅ Connected to MongoDB successfully');

    // ── Connection Events ────────────────────
    mongoose.connection.on('error', (err) => {
      logger.error(`MongoDB connection error: ${err.message}`);
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected. Attempting reconnection...');
    });

    mongoose.connection.on('reconnected', () => {
      logger.info('MongoDB reconnected successfully');
    });

  } catch (error) {
    logger.error(`Failed to connect to MongoDB: ${error.message}`);
    logger.error('Bot will continue without database features.');
  }
}

module.exports = connectDatabase;
