// Fails when UI code hardcodes a color instead of using a theme token, so new
// pages and components keep working in light and dark mode. Run via
// `npm run lint`. Tokens and their meaning: src/index.css.
//
// A line that must keep a fixed color (e.g. a canvas export that is always
// white) can opt out with a `theme-ok` comment explaining why.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

// Files whose colors are data, not UI chrome.
const ALLOWED_FILES = new Set([
  'src/index.css', // defines the tokens
  'src/lib/groupColors.ts', // palette users pick group colors from
  'src/components/FieldMapper.tsx', // fixed identity colors per import field
  'src/lib/config.ts', // default branding accent
  'src/components/AppLogo.tsx', // the one place the logo file is referenced
]);

const CHECKS = [
  {
    // bg-[#fff], text-[rgb(...)], hover:border-[#eee] ... (shadows are exempt)
    re: /(?:bg|text|border(?:-[trblxy])?|ring(?:-offset)?|fill|stroke|divide|outline|from|via|to|decoration|placeholder|caret|accent)-\[(?:#|rgba?\(|hsla?\(|color-mix)/,
    message: 'arbitrary color class — use a theme token (bg-surface-muted, text-success, ...)',
  },
  {
    // '#ffffff' / "#fff" / `#abc` in code (inline styles, SVG, constants)
    re: /['"`]#[0-9a-fA-F]{3,8}['"`]/,
    message: 'hex color literal — use a token, e.g. var(--color-surface) in styles/SVG',
  },
  {
    re: /(?<!shadow-\[[^\]]*)\b(?:rgba?|hsla?)\(\s*\d/,
    message: 'rgb()/hsl() color — use a token (opacity modifiers work: bg-scrim/40)',
  },
  {
    // Tailwind's default palette is disabled (tailwind.config.ts), so these
    // classes would silently render nothing.
    re: /\b(?:bg|text|border|ring|fill|stroke|divide|outline|from|via|to|decoration|placeholder|caret|accent)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/,
    message: 'Tailwind palette color — it does not exist here; use a theme token',
  },
  {
    re: /["'`]\/favicon\.svg["'`]/,
    message: 'raw logo image — use <AppLogo /> so the logo adapts to dark mode',
  },
];

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(tsx?|css)$/.test(entry.name) ? [full] : [];
  });

const problems = [];
for (const file of walk(path.join(ROOT, 'src'))) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  if (ALLOWED_FILES.has(rel)) continue;
  fs.readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (line.includes('theme-ok')) return;
      for (const { re, message } of CHECKS) {
        if (re.test(line)) problems.push(`${rel}:${i + 1}  ${message}\n    ${line.trim()}`);
      }
    });
}

if (problems.length) {
  console.error(`Hardcoded colors found (${problems.length}):\n\n${problems.join('\n\n')}\n`);
  console.error('See the theme token notes at the top of src/index.css.');
  process.exit(1);
}
console.log('Theme check passed: no hardcoded colors.');
