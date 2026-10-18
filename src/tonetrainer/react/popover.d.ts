import 'react';

// The native popover API (TransportBar's tempo and section popovers); React
// 18's types predate it. Written lowercase so React passes them through as is.
declare module 'react' {
  interface HTMLAttributes<T> {
    popover?: 'auto' | 'manual' | '';
  }
  interface ButtonHTMLAttributes<T> {
    popovertarget?: string;
  }
}
