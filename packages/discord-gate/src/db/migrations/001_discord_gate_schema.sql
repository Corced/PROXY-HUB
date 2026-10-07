-- DiscordGate tables — all prefixed discord_gate_ to avoid
-- collisions with existing New API tables

CREATE TABLE IF NOT EXISTS discord_gate_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_id      VARCHAR(20) UNIQUE NOT NULL,
  discord_username VARCHAR(100) NOT NULL,
  new_api_user_id VARCHAR(100),
  role            VARCHAR(20) NOT NULL DEFAULT 'MEMBER'
                  CHECK (role IN ('MEMBER', 'REVOKED')),
  status          VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
                  CHECK (status IN ('ACTIVE', 'REVOKED', 'BANNED')),
  last_login      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS discord_gate_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id       UUID NOT NULL
                  REFERENCES discord_gate_members(id) ON DELETE CASCADE,
  session_token   VARCHAR(255) UNIQUE NOT NULL,
  ip_address      VARCHAR(45),
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS discord_gate_audit (
  id              BIGSERIAL PRIMARY KEY,
  event_type      VARCHAR(60) NOT NULL,
  discord_id      VARCHAR(20),
  new_api_user_id VARCHAR(100),
  ip_address      VARCHAR(45),
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_dgm_discord_id
  ON discord_gate_members(discord_id);
CREATE INDEX IF NOT EXISTS idx_dgm_status
  ON discord_gate_members(status);
CREATE INDEX IF NOT EXISTS idx_dgs_member
  ON discord_gate_sessions(member_id);
CREATE INDEX IF NOT EXISTS idx_dgs_expires
  ON discord_gate_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_dga_discord
  ON discord_gate_audit(discord_id);
CREATE INDEX IF NOT EXISTS idx_dga_event
  ON discord_gate_audit(event_type);

-- Updated_at trigger for members
CREATE OR REPLACE FUNCTION discord_gate_update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER discord_gate_members_updated_at
BEFORE UPDATE ON discord_gate_members
FOR EACH ROW EXECUTE FUNCTION discord_gate_update_updated_at();