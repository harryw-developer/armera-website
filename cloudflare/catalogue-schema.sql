-- The catalogue as real tables.
--
-- Why: with one JSON document per category, two people editing different
-- products in the same category overwrite each other — whoever saves second
-- wins, silently. Taps alone holds 36 products. Rows make an edit touch one
-- product, so concurrent edits cannot clobber one another, and a product can
-- be queried, indexed and reported on without loading the whole category.
--
-- `extra` on every table holds any field not broken out into a column, so the
-- original document can always be reassembled exactly. Nothing is dropped.
--
-- pages, retailers, videos, gallery and instruction_links stay as documents in
-- site_content: they are genuinely settings and lists, and splitting them up
-- would buy nothing.

create table if not exists catalogue_categories (
  key      text primary key,
  slug     text not null unique,
  name     text not null,
  hero     text,
  extra    text,
  position integer not null
);

create table if not exists catalogue_ranges (
  id           integer primary key,
  category_key text not null references catalogue_categories(key) on delete cascade,
  slug         text not null,
  name         text not null,
  title        text,
  tagline      text,
  footnote     text,
  hero         text,
  alt_hero     text,
  swatches     text,
  addons       text,
  features     text,
  extra        text,
  position     integer not null,
  unique (category_key, slug)
);

create table if not exists catalogue_products (
  id             integer primary key,
  range_id       integer not null references catalogue_ranges(id) on delete cascade,
  slug           text not null,
  name           text not null,
  image          text,
  dims           text,
  note           text,
  footnote       text,
  spec           text,
  drawing        text,
  basin_link     text,
  images_by_code text,
  gallery        text,
  goes_with      text,
  extra          text,
  position       integer not null,
  unique (range_id, slug)
);

create table if not exists catalogue_variants (
  id         integer primary key,
  product_id integer not null references catalogue_products(id) on delete cascade,
  sku        text not null,
  finish     text,
  price      real,
  code       text,
  image      text,
  extra      text,
  position   integer not null
);

create index if not exists ranges_cat_idx     on catalogue_ranges (category_key, position);
create index if not exists products_range_idx on catalogue_products (range_id, position);
create index if not exists variants_prod_idx  on catalogue_variants (product_id, position);
create index if not exists variants_sku_idx   on catalogue_variants (sku);
create index if not exists products_slug_idx  on catalogue_products (slug);
