// Tiny classnames helper — joins truthy class strings.
export const cn = (...parts: Array<string | false | null | undefined>): string =>
  parts.filter(Boolean).join(' ');
