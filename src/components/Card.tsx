import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export const Card = ({ className, children, ...props }: CardProps) => (
  <div className={cn('bg-surface border border-border rounded-md p-5', className)} {...props}>
    {children}
  </div>
);
