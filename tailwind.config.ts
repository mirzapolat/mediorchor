import type { Config } from 'tailwindcss';

// A theme token as a Tailwind color that supports opacity modifiers.
const token = (name: string) => `rgb(var(--c-${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // For the rare case a token isn't enough: dark:... variants.
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    // Replaces (not extends) Tailwind's palette: only theme tokens exist, so
    // bg-gray-100 & co. can't sneak in and every color works in dark mode.
    // Add a token in src/index.css (light + dark) before adding a color here.
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      inherit: 'inherit',
      bg: token('bg'),
      surface: {
        DEFAULT: token('surface'),
        subtle: token('surface-subtle'),
        muted: token('surface-muted'),
        hover: token('surface-hover'),
      },
      border: {
        DEFAULT: token('border'),
        strong: token('border-strong'),
      },
      text: {
        DEFAULT: token('text'),
        secondary: token('text-secondary'),
        tertiary: token('text-tertiary'),
      },
      accent: {
        DEFAULT: token('accent'),
        hover: token('accent-hover'),
      },
      // Inverse pair: swaps in dark mode (see index.css).
      black: {
        DEFAULT: token('black'),
        hover: token('black-hover'),
      },
      white: token('white'),
      success: {
        DEFAULT: token('success'),
        strong: token('success-strong'),
        soft: token('success-soft'),
        'soft-strong': token('success-soft-strong'),
      },
      danger: {
        DEFAULT: token('danger'),
        strong: token('danger-strong'),
        soft: token('danger-soft'),
      },
      info: {
        soft: token('info-soft'),
        'soft-strong': token('info-soft-strong'),
      },
      scrim: token('scrim'),
    },
    extend: {
      // Preflight's default border color would fall back to the (removed)
      // gray palette, i.e. currentColor; plain `border` means the border token.
      borderColor: {
        DEFAULT: token('border'),
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        md: '6px',
      },
    },
  },
  plugins: [],
} satisfies Config;
