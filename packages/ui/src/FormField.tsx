'use client';

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Search, XCircle } from 'lucide-react';
import { cn } from './cn';

/* ------------------------------- Fields ------------------------------ */

interface FieldShellProps {
  id: string;
  label?: ReactNode;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
  labelAction?: ReactNode;
}

export function FieldShell({ id, label, hint, error, required, className, children, labelAction }: FieldShellProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <div className="flex items-center justify-between gap-2">
          <label htmlFor={id} className="text-[13px] font-semibold text-ink">
            {label}
            {required && (
              <span className="text-red-600" aria-hidden>
                {' '}
                *
              </span>
            )}
          </label>
          {labelAction}
        </div>
      )}
      {children}
      {error ? (
        <p id={`${id}-error`} className="flex items-start gap-1 text-[12.5px] font-medium text-red-700" role="alert">
          <XCircle className="mt-px size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[12.5px] text-ink-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const controlBase =
  'w-full rounded-lg border bg-white text-sm text-ink placeholder:text-ink-subtle/80 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-600/30 disabled:bg-canvas disabled:text-ink-subtle';
const controlBorder = (error?: string) => (error ? 'border-red-400 focus:border-red-500' : 'border-line-strong focus:border-brand-600');

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string;
  prefix?: ReactNode;
  suffix?: ReactNode;
  containerClassName?: string;
  labelAction?: ReactNode;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, prefix, suffix, id, className, containerClassName, required, labelAction, ...rest },
  ref,
) {
  const autoId = useId();
  const fid = id ?? autoId;
  const describedBy = error ? `${fid}-error` : hint ? `${fid}-hint` : undefined;
  return (
    <FieldShell id={fid} label={label} hint={hint} error={error} required={required} className={containerClassName} labelAction={labelAction}>
      <div className="relative flex items-center">
        {prefix && <span className="pointer-events-none absolute left-3 flex items-center text-sm text-ink-subtle">{prefix}</span>}
        <input
          ref={ref}
          id={fid}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(controlBase, controlBorder(error), 'h-10 px-3', prefix ? 'pl-9' : '', suffix ? 'pr-11' : '', className)}
          {...rest}
        />
        {suffix && <span className="absolute right-1.5 flex items-center">{suffix}</span>}
      </div>
    </FieldShell>
  );
});

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string;
  containerClassName?: string;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { label, hint, error, id, className, containerClassName, required, rows = 4, ...rest },
  ref,
) {
  const autoId = useId();
  const fid = id ?? autoId;
  return (
    <FieldShell id={fid} label={label} hint={hint} error={error} required={required} className={containerClassName}>
      <textarea
        ref={ref}
        id={fid}
        rows={rows}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${fid}-error` : hint ? `${fid}-hint` : undefined}
        className={cn(controlBase, controlBorder(error), 'px-3 py-2.5 leading-relaxed', className)}
        {...rest}
      />
    </FieldShell>
  );
});

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string;
  options: { value: string; label: string; disabled?: boolean }[];
  placeholder?: string;
  containerClassName?: string;
}

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { label, hint, error, id, options, placeholder, className, containerClassName, required, ...rest },
  ref,
) {
  const autoId = useId();
  const fid = id ?? autoId;
  return (
    <FieldShell id={fid} label={label} hint={hint} error={error} required={required} className={containerClassName}>
      <select
        ref={ref}
        id={fid}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${fid}-error` : hint ? `${fid}-hint` : undefined}
        className={cn(controlBase, controlBorder(error), 'h-10 appearance-none bg-[length:16px] bg-[right_10px_center] bg-no-repeat pl-3 pr-9', className)}
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%234b5a6b' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
        }}
        {...rest}
      >
        {placeholder !== undefined && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
});

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  label = 'Search',
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  label?: string;
  className?: string;
}) {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" aria-hidden />
      <input
        type="search"
        lang="bn"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(controlBase, 'h-10 border-line-strong pl-9 pr-3 focus:border-brand-600')}
      />
    </div>
  );
}

export function Checkbox({
  label,
  checked,
  onChange,
  description,
  id,
  disabled,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  description?: ReactNode;
  id?: string;
  disabled?: boolean;
}) {
  const autoId = useId();
  const fid = id ?? autoId;
  return (
    <div className="flex items-start gap-2.5">
      <input
        id={fid}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 shrink-0 rounded border-line-strong accent-brand-600"
      />
      <label htmlFor={fid} className="text-sm leading-snug">
        <span className="font-medium text-ink">{label}</span>
        {description && <span className="block text-[12.5px] text-ink-subtle">{description}</span>}
      </label>
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
  size = 'md',
  describedBy,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  describedBy?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        size === 'md' ? 'h-6 w-11' : 'h-5 w-9',
        checked ? 'bg-brand-600' : 'bg-slate-300',
      )}
    >
      <span
        className={cn(
          'inline-block rounded-full bg-white shadow transition-transform',
          size === 'md' ? 'size-5' : 'size-4',
          checked ? (size === 'md' ? 'translate-x-[22px]' : 'translate-x-[18px]') : 'translate-x-0.5',
        )}
      />
    </button>
  );
}
