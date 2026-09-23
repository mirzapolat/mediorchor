import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

const fieldClasses =
  'w-full border border-border rounded-md px-3 py-2 text-base bg-white placeholder:text-text-tertiary ' +
  'focus:outline-none focus:border-black transition-colors duration-150';

interface LabelWrapProps {
  label?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}

export const Field = ({ label, htmlFor, children }: LabelWrapProps) => (
  <div>
    {label && (
      <label htmlFor={htmlFor} className="block text-sm font-medium text-text mb-1.5">
        {label}
      </label>
    )}
    {children}
  </div>
);

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
}

export const Input = ({ label, id, className, ...props }: InputProps) => (
  <Field label={label} htmlFor={id}>
    <input id={id} className={cn(fieldClasses, className)} {...props} />
  </Field>
);

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: ReactNode;
}

export const Textarea = ({ label, id, className, ...props }: TextareaProps) => (
  <Field label={label} htmlFor={id}>
    <textarea id={id} className={cn(fieldClasses, 'min-h-[80px] resize-y', className)} {...props} />
  </Field>
);

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: ReactNode;
}

export const Select = ({ label, id, className, children, ...props }: SelectProps) => (
  <Field label={label} htmlFor={id}>
    <select id={id} className={cn(fieldClasses, 'pr-9', className)} {...props}>
      {children}
    </select>
  </Field>
);
