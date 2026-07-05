-- Rollback wallet extensions

DROP TABLE IF EXISTS payment_orders;

ALTER TABLE transactions
  DROP COLUMN IF EXISTS platform_fee,
  DROP COLUMN IF EXISTS seller_amount,
  DROP COLUMN IF EXISTS escrow_release_at;

ALTER TABLE wallet_ledger
  DROP COLUMN IF EXISTS locked_after;

ALTER TABLE wallets
  DROP COLUMN IF EXISTS daily_spent,
  DROP COLUMN IF EXISTS daily_limit,
  DROP COLUMN IF EXISTS is_frozen;
