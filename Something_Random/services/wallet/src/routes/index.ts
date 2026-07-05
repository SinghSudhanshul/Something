import { Router } from 'express';
import { asyncHandler } from '../middleware/error-handler.js';
import { authenticate } from '../middleware/auth.js';
import {
  getBalance,
  getTransactions,
  initiateTopup,
  initiateWithdrawal,
  transferFunds,
} from '../controllers/wallet.js';

export const walletRoutes: Router = Router();

// All wallet routes require authentication
walletRoutes.use(authenticate);

walletRoutes.get('/balance', asyncHandler(getBalance));
walletRoutes.get('/transactions', asyncHandler(getTransactions));
walletRoutes.post('/topup', asyncHandler(initiateTopup));
walletRoutes.post('/withdraw', asyncHandler(initiateWithdrawal));
walletRoutes.post('/transfer', asyncHandler(transferFunds));
