-- NEXUS Wallet Service — Schema Migration
-- Extends the shared schema with wallet-specific fields.

-- Add columns needed by the wallet service that aren't in the shared Drizzle schema
ALTER TABLE wallets
  ADD COLUMN IF NOT EXISTS daily_spent NUMERIC(12,2) NOT NULL DEFAULT '0.00',
  ADD COLUMN IF NOT EXISTS daily_limit NUMERIC(12,2) NOT NULL DEFAULT '10000.00',
  ADD COLUMN IF NOT EXISTS is_frozen BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE wallet_ledger
  ADD COLUMN IF NOT EXISTS locked_after NUMERIC(12,2);

-- CRITICAL: wallet_ledger is APPEND ONLY — revoke destructive operations
REVOKE UPDATE, DELETE ON wallet_ledger FROM PUBLIC;

-- Add transactions columns
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS platform_fee NUMERIC(12,2) NOT NULL DEFAULT '0.00',
  ADD COLUMN IF NOT EXISTS seller_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS escrow_release_at TIMESTAMPTZ;

-- Payment orders table for Razorpay integration
CREATE TABLE IF NOT EXISTS payment_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  wallet_id UUID NOT NULL REFERENCES wallets(id),
  amount NUMERIC(12,2) NOT NULL,
  razorpay_order_id VARCHAR(255) NOT NULL UNIQUE,
  razorpay_payment_id VARCHAR(255) UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'captured', 'failed')),
  idempotency_key VARCHAR(255) UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_orders_user ON payment_orders (user_id);
CREATE INDEX IF NOT EXISTS idx_payment_orders_status ON payment_orders (status);
