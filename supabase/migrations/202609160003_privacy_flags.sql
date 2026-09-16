-- Add discoverable and contactable flags to profiles
alter table profiles add column discoverable boolean not null default false;
alter table profiles add column contactable boolean not null default false;
