-- ARMERA site database, D1 (SQLite) equivalent of the Supabase Postgres schema.
-- jsonb becomes TEXT holding JSON: SQLite has no jsonb, and every consumer
-- already parses these as JSON documents. timestamptz becomes TEXT holding
-- ISO-8601 in UTC, which sorts and compares correctly as a string.

create table if not exists site_content (
  key        text primary key,
  data       text not null,
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

create table if not exists page_views (
  id            integer primary key autoincrement,
  ts            text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  path          text not null,
  page_type     text,
  item_name     text,
  item_ref      text,
  referrer_host text,
  device        text check (device is null or device in ('mobile','tablet','desktop')),
  session_id    text not null
);
create index if not exists page_views_ts_idx   on page_views (ts desc);
create index if not exists page_views_type_idx on page_views (page_type, ts desc);
create index if not exists page_views_item_idx on page_views (item_name, ts desc);

create table if not exists guarantee_registrations (
  id                 integer primary key autoincrement,
  created_at         text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  title              text,
  first_name         text not null,
  last_name          text not null,
  email              text not null,
  address1           text not null,
  address2           text,
  town               text not null,
  postcode           text not null,
  country            text,
  retailer_name      text not null,
  purchase_date      text not null,
  developer_name     text,
  moved_in_date      text,
  installer_name     text,
  installer_address1 text,
  installer_address2 text,
  installer_town     text,
  installer_postcode text,
  installer_country  text,
  products           text not null default '[]',
  proof_file         text,
  notes              text,
  status             text not null default 'new'
);
create index if not exists guarantee_created_idx on guarantee_registrations (created_at desc);
