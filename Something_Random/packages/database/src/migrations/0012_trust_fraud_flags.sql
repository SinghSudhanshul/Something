-- Phase 3B: Trust Fraud Flags Schema

CREATE TABLE IF NOT EXISTS fraud_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  transaction_id UUID REFERENCES transactions(id),
  fraud_score INTEGER NOT NULL,
  action VARCHAR(50) NOT NULL,
  features JSONB NOT NULL DEFAULT '{}',
  resolved BOOLEAN NOT NULL DEFAULT false,
  resolved_by UUID REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fraud_flags_user ON fraud_flags(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fraud_flags_unresolved ON fraud_flags(user_id) WHERE resolved = false;
