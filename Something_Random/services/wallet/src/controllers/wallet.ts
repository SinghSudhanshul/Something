import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/error-handler.js';
import { logger } from '../utils/logger.js';

// Mock storage - replace with PostgreSQL with ACID guarantees
const walletsStore = new Map<string, {
  id: string;
  userId: string;
  balance: number;
  lockedBalance: number;
  currency: string;
  createdAt: Date;
}>();

const ledgerStore = new Map<string, Array<{
  id: string;
  walletId: string;
  transactionId: string;
  entryType: 'debit' | 'credit';
  amount: number;
  balanceAfter: number;
  createdAt: Date;
}>>();

const transactionsStore = new Map<string, {
  id: string;
  referenceType: string;
  referenceId: string;
  amount: number;
  status: 'pending' | 'completed' | 'failed' | 'reversed';
  idempotencyKey: string;
  createdAt: Date;
}>();

const processedWebhooks = new Set<string>();

/**
 * GET /wallet/balance
 * Get wallet balance for authenticated user
 */
export const getBalance = async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.user!.userId;

  let wallet = walletsStore.get(userId);

  // Create wallet if doesn't exist
  if (!wallet) {
    wallet = {
      id: crypto.randomUUID(),
      userId,
      balance: 0,
      lockedBalance: 0,
      currency: 'INR',
      createdAt: new Date(),
    };
    walletsStore.set(userId, wallet);
  }

  res.json({
    data: {
      user_id: userId,
      balance: wallet.balance,
      locked_balance: wallet.lockedBalance,
      currency: wallet.currency,
      available_balance: wallet.balance - wallet.lockedBalance,
    },
  });
};

/**
 * GET /wallet/transactions
 * Get transaction history
 */
export const getTransactions = async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const { limit = 20, type } = req.query;

  const transactions = Array.from(transactionsStore.values())
    .filter((t) => t.referenceId === userId || type === undefined)
    .slice(0, parseInt(limit as string));

  res.json({
    data: transactions,
    meta: {
      total: transactions.length,
      limit: parseInt(limit as string),
    },
  });
};

/**
 * POST /wallet/topup
 * Initiate wallet top-up via Razorpay
 */
export const initiateTopup = async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const { amount, idempotencyKey } = req.body;

  if (!amount || amount < 1) {
    throw new AppError('VALIDATION_ERROR', 400, 'Invalid amount');
  }

  if (!idempotencyKey) {
    throw new AppError('VALIDATION_ERROR', 400, 'Idempotency key required');
  }

  // Check for duplicate request
  const existingTx = Array.from(transactionsStore.values())
    .find((t) => t.idempotencyKey === idempotencyKey);

  if (existingTx) {
    res.json({
      message: 'Top-up already initiated',
      order_id: existingTx.referenceId,
      status: existingTx.status,
    });
    return;
  }

  // TODO: Create Razorpay order
  const razorpayOrderId = `order_${crypto.randomUUID()}`;

  // Store pending transaction
  const transaction = {
    id: crypto.randomUUID(),
    referenceType: 'topup',
    referenceId: razorpayOrderId,
    amount,
    status: 'pending' as const,
    idempotencyKey,
    createdAt: new Date(),
  };
  transactionsStore.set(transaction.id, transaction);

  res.json({
    message: 'Top-up initiated',
    order_id: razorpayOrderId,
    key_id: 'mock_razorpay_key',
    amount,
    currency: 'INR',
  });
};

/**
 * POST /wallet/withdraw
 * Initiate withdrawal to bank account
 */
export const initiateWithdrawal = async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const { amount, bankAccount, ifsc, idempotencyKey } = req.body;

  if (!amount || amount < 100) {
    throw new AppError('VALIDATION_ERROR', 400, 'Minimum withdrawal amount is ₹100');
  }

  if (!bankAccount || !ifsc) {
    throw new AppError('VALIDATION_ERROR', 400, 'Bank account details required');
  }

  const wallet = walletsStore.get(userId);
  if (!wallet || wallet.balance < amount) {
    throw new AppError('INSUFFICIENT_BALANCE', 400, 'Insufficient wallet balance');
  }

  // Create withdrawal transaction
  const transaction = {
    id: crypto.randomUUID(),
    referenceType: 'withdrawal',
    referenceId: `withdraw_${crypto.randomUUID()}`,
    amount: -amount,
    status: 'pending' as const,
    idempotencyKey: idempotencyKey || crypto.randomUUID(),
    createdAt: new Date(),
  };
  transactionsStore.set(transaction.id, transaction);

  // Debit wallet
  wallet.balance -= amount;
  walletsStore.set(userId, wallet);

  res.json({
    message: 'Withdrawal initiated',
    transaction_id: transaction.id,
    amount,
    status: 'pending',
    estimated_arrival: '2-3 business days',
  });
};

/**
 * POST /wallet/transfer
 * Transfer funds to another user
 */
export const transferFunds = async (req: AuthRequest, res: Response): Promise<void> => {
  const senderId = req.user!.userId;
  const { recipientId, amount, idempotencyKey } = req.body;

  if (!recipientId || !amount || amount <= 0) {
    throw new AppError('VALIDATION_ERROR', 400, 'Invalid transfer details');
  }

  if (recipientId === senderId) {
    throw new AppError('VALIDATION_ERROR', 400, 'Cannot transfer to yourself');
  }

  const senderWallet = walletsStore.get(senderId);
  if (!senderWallet || senderWallet.balance < amount) {
    throw new AppError('INSUFFICIENT_BALANCE', 400, 'Insufficient wallet balance');
  }

  // Get or create recipient wallet
  let recipientWallet = walletsStore.get(recipientId);
  if (!recipientWallet) {
    recipientWallet = {
      id: crypto.randomUUID(),
      userId: recipientId,
      balance: 0,
      lockedBalance: 0,
      currency: 'INR',
      createdAt: new Date(),
    };
    walletsStore.set(recipientId, recipientWallet);
  }

  // Double-entry bookkeeping
  const transactionId = crypto.randomUUID();
  const timestamp = new Date();

  // Debit sender
  senderWallet.balance -= amount;
  walletsStore.set(senderId, senderWallet);

  const senderLedger = ledgerStore.get(senderId) || [];
  senderLedger.push({
    id: crypto.randomUUID(),
    walletId: senderId,
    transactionId,
    entryType: 'debit',
    amount,
    balanceAfter: senderWallet.balance,
    createdAt: timestamp,
  });
  ledgerStore.set(senderId, senderLedger);

  // Credit recipient
  recipientWallet.balance += amount;
  walletsStore.set(recipientId, recipientWallet);

  const recipientLedger = ledgerStore.get(recipientId) || [];
  recipientLedger.push({
    id: crypto.randomUUID(),
    walletId: recipientId,
    transactionId,
    entryType: 'credit',
    amount,
    balanceAfter: recipientWallet.balance,
    createdAt: timestamp,
  });
  ledgerStore.set(recipientId, recipientLedger);

  // Record transaction
  transactionsStore.set(transactionId, {
    id: transactionId,
    referenceType: 'p2p_transfer',
    referenceId: senderId,
    amount,
    status: 'completed',
    idempotencyKey: idempotencyKey || crypto.randomUUID(),
    createdAt: timestamp,
  });

  logger.info('P2P transfer completed', { senderId, recipientId, amount });

  res.json({
    message: 'Transfer successful',
    transaction_id: transactionId,
    amount,
    recipient_id: recipientId,
  });
};

// Helper: Process Razorpay webhook (called by webhook controller)
export const processTopupCompletion = (
  paymentId: string,
  orderId: string,
  amount: number,
  userId: string
): void => {
  // Check for duplicate webhook
  if (processedWebhooks.has(paymentId)) {
    logger.warn('Duplicate webhook', { paymentId });
    return;
  }
  processedWebhooks.add(paymentId);

  // Find pending transaction
  const transaction = Array.from(transactionsStore.values())
    .find((t) => t.referenceId === orderId);

  if (!transaction) {
    logger.error('Transaction not found', { orderId });
    return;
  }

  // Get or create wallet
  let wallet = walletsStore.get(userId);
  if (!wallet) {
    wallet = {
      id: crypto.randomUUID(),
      userId,
      balance: 0,
      lockedBalance: 0,
      currency: 'INR',
      createdAt: new Date(),
    };
  }

  // Credit wallet
  const timestamp = new Date();
  wallet.balance += amount;
  walletsStore.set(userId, wallet);

  // Create ledger entry
  const transactionId = crypto.randomUUID();
  const ledger = ledgerStore.get(userId) || [];
  ledger.push({
    id: crypto.randomUUID(),
    walletId: userId,
    transactionId,
    entryType: 'credit',
    amount,
    balanceAfter: wallet.balance,
    createdAt: timestamp,
  });
  ledgerStore.set(userId, ledger);

  // Update transaction status
  transaction.status = 'completed';
  transactionsStore.set(transaction.id, transaction);

  logger.info('Top-up completed', { userId, paymentId, amount });
};
