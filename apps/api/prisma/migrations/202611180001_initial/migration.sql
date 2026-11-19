-- Initial GSM CaseDesk PostgreSQL migration.
-- Generated intentionally for explicit deployment review.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  region text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  keycloak_id text NOT NULL UNIQUE,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  role text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  team_id uuid REFERENCES teams(id),
  capacity integer NOT NULL DEFAULT 20,
  availability boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
