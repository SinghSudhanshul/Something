-- Campusly Database Schema
-- This script runs on first PostgreSQL startup

-- Campuses table (multi-tenancy foundation)
CREATE TABLE IF NOT EXISTS campuses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(200) NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,
    email_domains TEXT[] NOT NULL,  -- Allowed institutional email domains
    timezone VARCHAR(50) DEFAULT 'Asia/Kolkata',
    currency CHAR(3) DEFAULT 'INR',
    is_active BOOLEAN DEFAULT TRUE,
    config JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert SRM Kattankulathur as default campus
INSERT INTO campuses (name, code, email_domains)
VALUES ('SRM Institute of Science and Technology', 'SRM_KTR', ARRAY['srmist.edu.in', 'srmuniversity.edu.in'])
ON CONFLICT (code) DO NOTHING;
