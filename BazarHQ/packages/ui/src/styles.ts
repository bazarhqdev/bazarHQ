import { cn } from './cn';

export type ButtonVariant = 'primary' | 'brand' | 'secondary' | 'ghost' | 'danger' | 'danger-outline';
export type ButtonSize = 'sm' | 'md' | 'lg';

const buttonBase =
  'inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-55 select-none whitespace-nowrap';
const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-navy-900 text-white hover:bg-navy-800 active:bg-navy-950',
  brand: 'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800',
  secondary: 'bg-white text-navy-900 border border-line-strong hover:bg-navy-50 active:bg-navy-100',
  ghost: 'text-navy-800 hover:bg-navy-50 active:bg-navy-100',
  danger: 'bg-red-600 text-white hover:bg-red-700 active:bg-red-800',
  'danger-outline': 'bg-white text-red-700 border border-red-200 hover:bg-red-50',
};
const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px]',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-5 text-[15px]',
};

export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', className?: string) {
  return cn(buttonBase, buttonVariants[variant], buttonSizes[size], className);
}
