import { sql } from "bun";

const up = async () => {
  await sql`DROP TABLE IF EXISTS yggdrasil_sessions`;
  await sql`DROP INDEX IF EXISTS idx_yggdrasil_tokens_profile`;
  await sql`DROP INDEX IF EXISTS idx_yggdrasil_tokens_user`;
  await sql`DROP TABLE IF EXISTS yggdrasil_tokens`;
  await sql`DROP TABLE IF EXISTS yggdrasil_profiles`;

  await sql`CREATE TABLE user_textures (
    uuid VARCHAR(32) PRIMARY KEY REFERENCES users(uuid) ON DELETE CASCADE,
    skin_url TEXT,
    skin_model VARCHAR(16),
    cape_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  )`;
};

const down = async () => {
  await sql`DROP TABLE IF EXISTS user_textures`;

  await sql`CREATE TABLE yggdrasil_profiles (
    uuid VARCHAR(32) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(uuid) ON DELETE CASCADE,
    username VARCHAR(64) NOT NULL UNIQUE,
    skin_url TEXT,
    skin_model VARCHAR(16),
    cape_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  )`;

  await sql`CREATE TABLE yggdrasil_tokens (
    access_token VARCHAR(64) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(uuid) ON DELETE CASCADE,
    profile_uuid VARCHAR(32) REFERENCES yggdrasil_profiles(uuid) ON DELETE SET NULL,
    username VARCHAR(64) NOT NULL,
    client_token VARCHAR(128) NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  )`;

  await sql`CREATE INDEX idx_yggdrasil_tokens_user ON yggdrasil_tokens(user_id)`;
  await sql`CREATE INDEX idx_yggdrasil_tokens_profile ON yggdrasil_tokens(profile_uuid)`;

  await sql`CREATE TABLE yggdrasil_sessions (
    server_id VARCHAR(128) PRIMARY KEY,
    profile_uuid VARCHAR(32) NOT NULL REFERENCES yggdrasil_profiles(uuid) ON DELETE CASCADE,
    username VARCHAR(64) NOT NULL,
    ip VARCHAR(45) NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  )`;
};

export { up, down };
