-- Requests for furniture colour swatches, sent in from /order-swatch/.
create table if not exists swatch_requests (
  id         integer primary key autoincrement,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  name       text not null,
  company    text,
  email      text not null,
  phone      text,
  address1   text not null,
  address2   text,
  town       text not null,
  postcode   text not null,
  swatches   text not null default '[]',
  notes      text,
  emailed    integer not null default 0,
  status     text not null default 'new'
);
create index if not exists swatch_created_idx on swatch_requests (created_at desc);
