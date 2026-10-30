-- Who may sign in to the admin, and how.
--
-- Two ways in, both landing on the same identity:
--   1. Cloudflare Access — Cloudflare proves who you are, no password stored.
--      Dormant until armera.co.uk is on Cloudflare; the code path is ready.
--   2. Email and password — works anywhere, including workers.dev today.
--
-- password_hash is PBKDF2-SHA256, stored as iterations$salt$hash in base64.
-- It is null until someone sets a password, and a null hash can never match.

create table if not exists admin_users (
  email         text primary key,
  display_name  text,
  password_hash text,
  prefs         text not null default '{}',
  created_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen     text,
  disabled      integer not null default 0
);

-- Failed sign-ins, so a password can't be guessed at speed.
create table if not exists auth_attempts (
  email    text not null,
  at       text not null,
  ok       integer not null
);
create index if not exists auth_attempts_idx on auth_attempts (email, at desc);
