/**
 * NEXUS Feast — Real-Time Order Gateway (WebSocket)
 *
 * JWT from query param, Redis pub/sub, 30s heartbeat.
 */

import type { FastifyInstance } from 'fastify';
import { createLogger } from '@nexus/utils';
import { Redis } from 'ioredis';
import { config } from '../../config.js';

const logger = createLogger('feast:ws-gateway');

export default async function orderGateway(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/v1/feast/ws', { websocket: true }, (connection, req) => {
    const token = (req.query as Record<string, string>).token;
    if (!token) {
      connection.send(JSON.stringify({ error: 'Missing token' }));
      connection.close();
      return;
    }

    let userId: string;
    try {
      const decoded = fastify.jwt.verify<{ id: string; campusId: string; role: string }>(token);
      userId = decoded.id;
    } catch {
      connection.send(JSON.stringify({ error: 'Invalid token', code: 401 }));
      connection.close();
      return;
    }

    // Dedicated subscriber for this connection
    const subscriber = new Redis(config.REDIS_URL);
    const subscriptions: string[] = [];

    // Forward Redis messages to WebSocket
    subscriber.on('message', (channel, message) => {
      try {
        connection.send(JSON.stringify({ channel, data: JSON.parse(message) }));
      } catch { /* connection may be closed */ }
    });

    // Handle incoming messages from client (subscribe requests)
    connection.on('message', (raw: Buffer | string) => {
      try {
        const msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString()) as { action: string; orderId?: string; canteenId?: string };

        if (msg.action === 'subscribe_order' && msg.orderId) {
          const channel = `feast:order:${msg.orderId}:status`;
          subscriber.subscribe(channel);
          subscriptions.push(channel);
          logger.debug({ userId, channel }, 'Subscribed to order status');
        }

        if (msg.action === 'subscribe_canteen' && msg.canteenId) {
          const channel = `feast:canteen:${msg.canteenId}:new_order`;
          subscriber.subscribe(channel);
          subscriptions.push(channel);
          logger.debug({ userId, channel }, 'Subscribed to canteen orders');
        }
      } catch { /* ignore malformed messages */ }
    });

    // Heartbeat: ping every 30s
    const heartbeat = setInterval(() => {
      try {
        connection.ping();
      } catch {
        clearInterval(heartbeat);
      }
    }, 30_000);

    // Close after 10s without pong
    let pongReceived = true;
    const pongCheck = setInterval(() => {
      if (!pongReceived) {
        connection.close();
        clearInterval(pongCheck);
        return;
      }
      pongReceived = false;
    }, 40_000);

    connection.on('pong', () => { pongReceived = true; });

    // Cleanup on close
    connection.on('close', () => {
      clearInterval(heartbeat);
      clearInterval(pongCheck);
      subscriber.unsubscribe(...subscriptions);
      subscriber.quit();
      logger.debug({ userId }, 'WebSocket connection closed');
    });

    connection.send(JSON.stringify({ type: 'connected', userId }));
    logger.info({ userId }, 'WebSocket connection established');
  });
}
