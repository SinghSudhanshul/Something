import type { Request, Response } from 'express';
import { AppError } from '../middleware/error-handler.js';
import { config } from '../config/index.js';
import { processTopupCompletion } from './wallet.js';
import { logger } from '../utils/logger.js';

/**
 * POST /webhooks/razorpay
 * Handle Razorpay payment webhook events
 */
export const handleRazorpayWebhook = async (req: Request, res: Response): Promise<void> => {
  const signature = req.headers['x-razorpay-signature'] as string;

  if (!signature) {
    throw new AppError('INVALID_SIGNATURE', 400, 'Missing webhook signature');
  }

  // TODO: Verify webhook signature using HMAC-SHA256
  // const expectedSignature = crypto
  //   .createHmac('sha256', config.razorpayWebhookSecret)
  //   .update(JSON.stringify(req.body))
  //   .digest('hex');
  // if (signature !== expectedSignature) {
  //   throw new AppError('INVALID_SIGNATURE', 400, 'Invalid webhook signature');
  // }

  const event = req.body as {
    event: string;
    payload: {
      payment: {
        entity: {
          id: string;
          order_id: string;
          amount: number;
          currency: string;
          status: string;
        };
      };
    };
  };

  logger.info('Razorpay webhook received', { event: event.event });

  switch (event.event) {
    case 'payment.captured': {
      const payment = event.payload.payment.entity;

      // Extract user ID from order notes (would be stored when creating order)
      const userId = 'user_' + payment.order_id.split('_')[1]; // Mock extraction

      processTopupCompletion(
        payment.id,
        payment.order_id,
        payment.amount / 100, // Convert paise to rupees
        userId
      );

      res.json({ success: true });
      break;
    }

    case 'payment.failed': {
      const payment = event.payload.payment.entity;
      logger.warn('Payment failed', { paymentId: payment.id, orderId: payment.order_id });

      // TODO: Update transaction status to failed
      res.json({ success: true });
      break;
    }

    default:
      logger.info('Unhandled webhook event', { event: event.event });
      res.json({ success: true, message: 'Event received' });
  }
};
