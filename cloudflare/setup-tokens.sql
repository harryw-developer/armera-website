-- One-time links for setting a first password. Single use, time limited,
-- and only ever able to set a password for the address they were issued to.
alter table admin_users add column setup_token text;
alter table admin_users add column setup_expires text;
create index if not exists admin_setup_idx on admin_users (setup_token);
