import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as SelectPrimitive from '@radix-ui/react-select';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { Check, ChevronDown, X } from 'lucide-react';
import { cn } from '../lib/cn';

/* ---------------- Dialog ---------------- */
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;

export function DialogContent({
  className,
  children,
  title,
}: {
  className?: string;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className='fixed inset-0 z-50 bg-[var(--scrim)] backdrop-blur-sm data-[state=open]:pf-fade-up' />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 w-[min(92vw,480px)] -translate-x-1/2 -translate-y-1/2 rounded-xl glass-strong p-5 data-[state=open]:pf-fade-up focus:outline-none',
          className,
        )}
      >
        {title && (
          <div className='mb-3 flex items-center justify-between'>
            <DialogPrimitive.Title className='text-base font-semibold'>
              {title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              className='rounded-md p-1.5 text-muted-fg transition-colors hover:bg-muted hover:text-fg'
              aria-label='Close'
            >
              <X className='h-4 w-4' />
            </DialogPrimitive.Close>
          </div>
        )}
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
export const DialogClose = DialogPrimitive.Close;

/* ---------------- Switch ---------------- */
export function Switch({
  checked,
  onCheckedChange,
  id,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  id?: string;
}) {
  return (
    <SwitchPrimitive.Root
      id={id}
      checked={checked}
      onCheckedChange={onCheckedChange}
      className='relative h-6 w-11 shrink-0 rounded-full inset transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=checked]:bg-primary data-[state=checked]:border-primary'
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'block h-4 w-4 translate-x-1 rounded-full bg-fg transition-transform',
          checked ? 'translate-x-[26px] bg-primary-fg' : 'bg-fg',
        )}
      />
    </SwitchPrimitive.Root>
  );
}

/* ---------------- Select ---------------- */
export function Select({
  value,
  onValueChange,
  options,
  className,
  placeholder,
  ariaLabel,
}: {
  value: string;
  onValueChange: (v: string) => void;
  options: { value: string; label: string }[];
  className?: string;
  placeholder?: string;
  ariaLabel?: string;
}) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange}>
      <SelectPrimitive.Trigger
        aria-label={ariaLabel}
        className={cn(
          'inline-flex h-9 items-center justify-between gap-2 rounded-lg glass-sm px-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:inset',
          className,
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon>
          <ChevronDown className='h-4 w-4 text-muted-fg' />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          className='z-50 overflow-hidden rounded-lg glass-strong'
          position='popper'
          sideOffset={6}
        >
          <SelectPrimitive.Viewport className='p-1'>
            {options.map((o) => (
              <SelectPrimitive.Item
                key={o.value}
                value={o.value}
                className='relative flex h-8 cursor-pointer select-none items-center rounded-md px-7 text-sm outline-none data-[highlighted]:bg-muted data-[state=checked]:font-medium'
              >
                <SelectPrimitive.ItemIndicator className='absolute left-2'>
                  <Check className='h-3.5 w-3.5 text-fg' />
                </SelectPrimitive.ItemIndicator>
                <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

/* ---------------- Tooltip ---------------- */
export function Tip({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <TooltipPrimitive.Provider delayDuration={300}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            sideOffset={6}
            className='z-50 rounded-md bg-fg px-2 py-1 text-[11px] text-bg'
          >
            {label}
            <TooltipPrimitive.Arrow className='fill-fg' />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
