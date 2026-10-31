-- Lets a password change invalidate sessions issued before it. The number
-- goes into the session token; a token carrying an older one stops working.
alter table admin_users add column session_epoch integer not null default 0;
