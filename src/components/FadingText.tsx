import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { cn } from '@/lib/cn';

// Fades out to the right instead of an ellipsis — only when the text doesn't
// fit, so short text stays crisp to its last letter.
const FADE: CSSProperties = {
  maskImage: 'linear-gradient(to right, black calc(100% - 28px), transparent)',
  WebkitMaskImage: 'linear-gradient(to right, black calc(100% - 28px), transparent)',
};

export const FadingText = ({ children, className }: { children: string; className?: string }) => {
  const ref = useRef<HTMLSpanElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setOverflowing(el.scrollWidth > el.clientWidth + 1);
    measure();
    // Re-check when the sidebar is resized or collapsed.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [children]);

  return (
    <span
      ref={ref}
      title={overflowing ? children : undefined}
      className={cn('min-w-0 overflow-hidden whitespace-nowrap', className)}
      style={overflowing ? FADE : undefined}
    >
      {children}
    </span>
  );
};
