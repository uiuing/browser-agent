import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '../lib/cn';

/*
 * Flat black/white + frosted glass primitives.
 * Glass panels for elevated surfaces; inset wells for inputs/selected;
 * solid primary fill is the only strong accent. No dual shadows.
 */

/* ---------------- Button ---------------- */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-45 disabled:pointer-events-none select-none whitespace-nowrap',
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-fg hover:opacity-90 active:opacity-80',
        secondary: 'glass-sm text-fg hover:bg-accent',
        outline: 'flat text-fg hover:bg-muted',
        ghost: 'bg-transparent text-muted-fg hover:text-fg hover:bg-muted',
        destructive: 'flat text-destructive hover:bg-muted',
        link: 'text-fg underline-offset-4 hover:underline bg-transparent',
      },
      size: {
        sm: 'h-8 px-3 text-[13px]',
        md: 'h-9 px-4 text-sm',
        lg: 'h-11 px-6 text-base',
        icon: 'h-9 w-9',
        'icon-sm': 'h-8 w-8',
      },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, loading, children, disabled, ...props },
    ref,
  ) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Loader2 className='h-4 w-4 pf-spin' />}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';

/* ---------------- Badge ---------------- */
const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium inset',
  {
    variants: {
      tone: {
        neutral: 'text-muted-fg',
        verified: 'text-verified',
        failed: 'text-failed',
        running: 'text-running',
        healing: 'text-healing',
        skipped: 'text-skipped',
        primary: 'text-fg',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);
export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}
export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

/* ---------------- Card ---------------- */
export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-xl glass', className)} {...props} />;
}

/** Flat inset well — for grouped content / inputs that sit below the surface. */
export function Well({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg inset', className)} {...props} />;
}

/* ---------------- Input ---------------- */
export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'h-9 w-full rounded-lg inset px-3 text-sm text-fg placeholder:text-muted-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
      className,
    )}
    {...props}
  />
));
Input.displayName = 'Input';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'w-full rounded-lg inset px-3 py-2 text-sm text-fg placeholder:text-muted-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 resize-none',
      className,
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

/* ---------------- Label ---------------- */
export function Label({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn('text-[13px] font-medium text-fg', className)}
      {...props}
    />
  );
}

/* ---------------- Spinner ---------------- */
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-4 w-4 pf-spin text-muted-fg', className)} />;
}
