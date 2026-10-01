import { useEffect, useState } from 'react';

// Whether a CSS media query currently matches; follows changes live.
export const useMediaQuery = (query: string) => {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
};

// Placing bar markers needs a mouse or trackpad; on phones (and other
// touch-only devices) it is switched off.
export const useCanPlaceBars = () => useMediaQuery('(hover: hover) and (pointer: fine)');
