-- 2FA is required per role (comma-separated role names) instead of one switch
-- for every role above participant. The old switch carries over as all of them;
-- require_admin_2fa stays in the table but is no longer read.
alter table app_settings add column mfa_required_roles text not null default '';
update app_settings set mfa_required_roles = 'section_lead,manager,music_director,admin' where require_admin_2fa = 1;
