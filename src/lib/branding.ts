import { config } from './config';

// Darkens a hex color for the accent-hover variant.
const darken = (hex: string, amount = 0.12): string => {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return hex;
  const adj = (c: string) =>
    Math.max(0, Math.round(parseInt(c, 16) * (1 - amount)))
      .toString(16)
      .padStart(2, '0');
  return `#${adj(m[1])}${adj(m[2])}${adj(m[3])}`;
};

// Theme tokens are RGB channels ("239 161 0"), see index.css.
export const channels = (hex: string): string => {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m ? [m[1], m[2], m[3]].map((c) => parseInt(c, 16)).join(' ') : '239 161 0';
};

// Applies the branding (accent color, document title, favicon) once at
// startup. The values come from /config.js: Admin Config → Branding, else the
// VITE_* environment; the server also puts name and favicon into index.html.
export const applyBranding = () => {
  document.documentElement.style.setProperty('--c-accent', channels(config.accentColor));
  document.documentElement.style.setProperty('--c-accent-hover', channels(darken(config.accentColor)));
  document.title = config.appName;
  if (config.logoUrl) {
    const icon = document.getElementById('favicon') as HTMLLinkElement | null;
    if (icon) {
      icon.type = 'image/png';
      icon.href = config.logoUrl;
    }
  }
};
