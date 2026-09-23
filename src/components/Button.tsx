import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'accent';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  children: ReactNode;
}

const variantClasses: Record<Variant, string> = {
  primary: 'bg-black text-white hover:bg-black-hover',
  secondary: 'bg-white text-black border border-border hover:bg-surface-muted',
  accent: 'bg-accent text-white hover:bg-accent-hover',
};

export const Button = ({ variant = 'primary', className, children, ...props }: ButtonProps) => (
  <button
    className={cn(
      'inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors duration-150',
      'focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-1',
      'disabled:opacity-50 disabled:cursor-not-allowed',
      variantClasses[variant],
      className,
    )}
    {...props}
  >
    {children}
  </button>
);
