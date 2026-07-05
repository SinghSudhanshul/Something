/**
 * @nexus/utils — Wallet Service HTTP Client
 *
 * Single point of entry for all Phase 2 → Wallet service HTTP calls.
 * No service may call wallet endpoints with raw axios.
 *
 * Features:
 * - Typed request/response for every operation
 * - X-Internal-Secret + X-Correlation-Id headers on every call
 * - Retry: max 2 attempts, 200ms backoff for network errors only (NOT 4xx)
 * - All methods throw typed AppError on failure
 */

import axios, { type AxiosInstance, type AxiosError } from 'axios';
import { AppError, generateCorrelationId, retry } from './index.js';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface CreateTransactionRequest {
  buyerId: string;
  sellerId: string;
  amount: string; // decimal as string — never float
  module: string;
  referenceId: string;
  referenceType: string;
  description: string;
  idempotencyKey?: string;
}

export interface CreateTransactionResponse {
  transactionId: string;
  amount: string;
  platformFee: string;
  sellerAmount: string;
  status: string;
}

export interface EscrowResponse {
  transactionId: string;
  status: string;
  amount: string;
  message: string;
}

export interface WalletBalanceResponse {
  userId: string;
  balance: string;
  held: string;
  available: string;
  currency: string;
}

export interface WalletClientConfig {
  baseUrl: string;
  internalSecret: string;
  timeoutMs?: number;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Client
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class WalletClient {
  private readonly client: AxiosInstance;
  private readonly internalSecret: string;

  constructor(config: WalletClientConfig) {
    this.internalSecret = config.internalSecret;
    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: config.timeoutMs ?? 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  private buildHeaders(correlationId?: string): Record<string, string> {
    return {
      'X-Internal-Secret': this.internalSecret,
      'X-Correlation-Id': correlationId ?? generateCorrelationId(),
    };
  }

  private isNetworkError(error: AxiosError): boolean {
    // Retry only on network errors and 5xx, never on 4xx
    if (!error.response) return true; // network/timeout
    return error.response.status >= 500;
  }

  private handleError(error: unknown): never {
    if (axios.isAxiosError(error)) {
      const axiosErr = error as AxiosError<{ code?: string; message?: string }>;
      const status = axiosErr.response?.status ?? 500;
      const code = axiosErr.response?.data?.code ?? 'WALLET_ERROR';
      const message = axiosErr.response?.data?.message ?? 'Wallet service error';
      throw new AppError(status, code, message);
    }
    throw AppError.internal('Unexpected wallet client error');
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await retry(fn, 2, 200);
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Creates a new transaction record in the wallet service.
   */
  async createTransaction(
    req: CreateTransactionRequest,
    correlationId?: string,
  ): Promise<CreateTransactionResponse> {
    return this.withRetry(async () => {
      const { data } = await this.client.post<CreateTransactionResponse>(
        '/api/v1/wallet/transactions',
        req,
        { headers: this.buildHeaders(correlationId) },
      );
      return data;
    });
  }

  /**
   * Locks buyer funds into escrow for a transaction.
   */
  async initiateEscrow(
    transactionId: string,
    correlationId?: string,
  ): Promise<EscrowResponse> {
    return this.withRetry(async () => {
      const { data } = await this.client.post<EscrowResponse>(
        `/api/v1/wallet/transactions/${transactionId}/escrow`,
        {},
        { headers: this.buildHeaders(correlationId) },
      );
      return data;
    });
  }

  /**
   * Releases escrow funds to the seller.
   */
  async releaseEscrow(
    transactionId: string,
    correlationId?: string,
  ): Promise<EscrowResponse> {
    return this.withRetry(async () => {
      const { data } = await this.client.post<EscrowResponse>(
        `/api/v1/wallet/transactions/${transactionId}/escrow/release`,
        {},
        { headers: this.buildHeaders(correlationId) },
      );
      return data;
    });
  }

  /**
   * Refunds escrowed funds back to the buyer.
   */
  async refundEscrow(
    transactionId: string,
    correlationId?: string,
  ): Promise<EscrowResponse> {
    return this.withRetry(async () => {
      const { data } = await this.client.post<EscrowResponse>(
        `/api/v1/wallet/transactions/${transactionId}/escrow/refund`,
        {},
        { headers: this.buildHeaders(correlationId) },
      );
      return data;
    });
  }

  /**
   * Fetches wallet balance for a user.
   */
  async getWalletBalance(
    userId: string,
    correlationId?: string,
  ): Promise<WalletBalanceResponse> {
    return this.withRetry(async () => {
      const { data } = await this.client.get<WalletBalanceResponse>(
        `/api/v1/wallet/users/${userId}/balance`,
        { headers: this.buildHeaders(correlationId) },
      );
      return data;
    });
  }
}

/**
 * Factory function to create a WalletClient from environment variables.
 */
export function createWalletClient(
  baseUrl?: string,
  internalSecret?: string,
): WalletClient {
  const url = baseUrl ?? process.env['WALLET_SERVICE_URL'] ?? 'http://localhost:3003';
  const secret = internalSecret ?? process.env['INTERNAL_SERVICE_SECRET'] ?? '';

  if (!secret) {
    throw new Error('INTERNAL_SERVICE_SECRET is required for wallet client');
  }

  return new WalletClient({ baseUrl: url, internalSecret: secret });
}
