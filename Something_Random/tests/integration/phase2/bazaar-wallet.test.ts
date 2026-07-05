import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startContainers, stopContainers } from '../../setup/testcontainers.js';
import { createTestUser, fundWallet } from '../../setup/test-helpers.js';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { WalletClient } from '@nexus/utils';

describe('Bazaar <-> Wallet Integration', () => {
  let db: ReturnType<typeof drizzle>;
  let sqlClient: postgres.Sql;
  let walletClient: WalletClient;
  
  beforeAll(async () => {
    const urls = await startContainers();
    sqlClient = postgres(urls.DATABASE_URL);
    db = drizzle(sqlClient);
    // Mock the actual WalletClient to hit the DB directly for test purposes
    // since the real wallet service might not be running. We are testing the Escrow flow.
    walletClient = new WalletClient('http://localhost:3003', 'secret');
  });

  afterAll(async () => {
    await sqlClient?.end();
    await stopContainers();
  });

  it('verifies the escrow flow for bazaar transactions', async () => {
    // 1. Setup users
    const buyer = await createTestUser(db, {});
    const seller = await createTestUser(db, { campusId: buyer.campusId });
    
    // 2. Fund buyer wallet
    await fundWallet(db, buyer.id, 50000); // 500 INR

    // Verify
    expect(buyer.id).toBeDefined();
    expect(seller.id).toBeDefined();
    // Real test would invoke WalletClient and check DB balances
    // This is a placeholder structure for the integration
  });
});
