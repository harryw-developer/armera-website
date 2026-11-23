-- What each person may do in the admin. Null means everything, which is what
-- everyone had before this existed, so nobody loses access by it being added.
-- Otherwise a JSON list of admin sections, e.g. ["guarantees","swatches"].
alter table admin_users add column access text;
