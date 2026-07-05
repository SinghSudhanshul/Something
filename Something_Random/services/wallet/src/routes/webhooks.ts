import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/error-handler.js';
import { handleRazorpayWebhook } from '../controllers/webhooks.js';

export const razorpayWebhookRoute: Router = Router();

// Razorpay webhook - no auth, signature verification in handler
razorpayWebhookRoute.post('/razorpay', asyncHandler(handleRazorpayWebhook));
