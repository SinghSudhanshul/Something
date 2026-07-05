/**
 * Campusly Wallet Service
 *
 * Handles wallet management, double-entry bookkeeping,
 * escrow, and payment gateway integration (Razorpay).
 *
 * CRITICAL: This service handles real money. All operations
 * must be ACID-compliant and auditable.
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config/index.js';
import { walletRoutes } from './routes/index.js';
import { razorpayWebhookRoute } from './routes/webhooks.js';
import { errorHandler } from './middleware/error-handler.js';
import { logger } from './utils/logger.js';

const app: express.Application = express();

// Middleware
app.use(helmet());
app.use(cors({ origin: config.corsOrigins, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'wallet', timestamp: new Date().toISOString() });
});

// Routes
app.use('/wallet', walletRoutes);
app.use('/webhooks', razorpayWebhookRoute);

// Error handling
app.use(errorHandler);

// Start server
app.listen(config.port, () => {
  logger.info(`Wallet Service started on port ${config.port}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

export default app;
