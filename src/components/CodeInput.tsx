import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

const LENGTH = 6;

// A 6-digit verification code as six large boxes (grouped 3 · 3). One real,
// invisible input sits on top, so typing, deleting, pasting and the
// browser's one-time-code autofill (SMS / password managers) all just work.
// onComplete fires once all six digits are in, e.g. to submit the form.
export const CodeInput = ({
  value,
  onChange,
  onComplete,
  label,
  autoFocus,
  disabled,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  onComplete?: () => void;
  label: string;
  autoFocus?: boolean;
  disabled?: boolean;
  id?: string;
}) => {
  const [focused, setFocused] = useState(false);
  const previous = useRef(value);

  // After the parent re-rendered with the full code, so its handler sees it.
  useEffect(() => {
    if (value.length === LENGTH && previous.current.length < LENGTH) onComplete?.();
    previous.current = value;
  }, [value, onComplete]);

  const active = focused ? Math.min(value.length, LENGTH - 1) : -1;

  const box = (index: number) => {
    const digit = value[index];
    const isActive = index === active && !disabled;
    return (
      <div
        key={index}
        className={cn(
          'flex h-14 min-w-0 max-w-12 flex-1 items-center justify-center rounded-xl border bg-white text-2xl font-semibold tabular-nums transition-[border-color,box-shadow] duration-150',
          isActive ? 'border-black shadow-[0_0_0_4px_rgb(var(--c-black)/0.07)]' : digit ? 'border-border-strong' : 'border-border',
        )}
      >
        {digit ?? (isActive && value.length < LENGTH ? <span className="otp-caret h-6 w-px bg-text" /> : null)}
      </div>
    );
  };

  return (
    <div className={cn('relative', disabled && 'opacity-60')}>
      <div className="flex items-center justify-center gap-1.5 sm:gap-2" aria-hidden>
        {[0, 1, 2].map(box)}
        <span className="mx-0.5 h-0.5 w-2.5 flex-shrink-0 rounded-full bg-border-strong" />
        {[3, 4, 5].map(box)}
      </div>
      <input
        id={id}
        aria-label={label}
        className="otp-input absolute inset-0 h-full w-full cursor-text bg-transparent text-base text-transparent caret-transparent outline-none selection:bg-transparent disabled:cursor-not-allowed"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={LENGTH}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, LENGTH))}
        // Keep the cursor at the end: digits are added and removed there.
        onSelect={(e) => {
          const input = e.currentTarget;
          if (input.selectionStart !== input.value.length) {
            input.setSelectionRange(input.value.length, input.value.length);
          }
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        autoFocus={autoFocus}
        disabled={disabled}
        required
      />
    </div>
  );
};
