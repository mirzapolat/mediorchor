-- Instance branding (Admin → Configuration → Branding). Null = the value from
-- the environment (VITE_APP_NAME, VITE_ACCENT_COLOR, the bundled logo).
alter table app_settings add column brand_name text;
alter table app_settings add column brand_accent text;
-- Uploaded square PNG (/files/photos/branding/...), also used as favicon.
alter table app_settings add column brand_logo_url text;
-- Flip the logo's lightness in dark mode (for dark line art on transparency).
alter table app_settings add column brand_logo_invert boolean not null default 0;
