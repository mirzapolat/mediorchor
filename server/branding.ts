// Instance branding: what Admin Config sets, else the environment. Read per
// call (one indexed row) so a change applies to the next page load and email.
import { db } from './db.ts';
import { env } from './env.ts';

interface BrandingRow {
  brand_name: string | null;
  brand_accent: string | null;
  brand_logo_url: string | null;
  brand_logo_invert: number;
}

export const branding = () => {
  const row = db
    .prepare('select brand_name, brand_accent, brand_logo_url, brand_logo_invert from app_settings where id = 1')
    .get() as BrandingRow | undefined;
  return {
    appName: row?.brand_name?.trim() || env.client.VITE_APP_NAME,
    accentColor: row?.brand_accent || env.client.VITE_ACCENT_COLOR,
    // null = the bundled logo (/favicon.svg).
    logoUrl: row?.brand_logo_url || null,
    logoInvert: row?.brand_logo_url ? Boolean(row.brand_logo_invert) : true,
  };
};

// What the browser gets as window.__APP_CONFIG__ (served as /config.js).
export const clientConfig = () => {
  const b = branding();
  return {
    ...env.client,
    VITE_APP_NAME: b.appName,
    VITE_ACCENT_COLOR: b.accentColor,
    LOGO_URL: b.logoUrl,
    LOGO_INVERT: b.logoInvert,
  };
};

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

// Puts the name and logo into index.html, so the tab title, favicon and link
// previews are right before any script runs.
export const brandIndexHtml = (html: string) => {
  const b = branding();
  let out = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(b.appName)}</title>`);
  if (b.logoUrl) {
    out = out.replace(
      /<link id="favicon"[^>]*>/,
      `<link id="favicon" rel="icon" type="image/png" href="${escapeHtml(b.logoUrl)}" />`,
    );
  }
  return out;
};
