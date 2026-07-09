import * as React from 'react';
import { cn } from '../lib/cn';

export function EmptyState({
  icon,
  title,
  desc,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  desc: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3.5 px-6 py-12 text-center',
        className,
      )}
    >
      <div className='flex h-16 w-16 items-center justify-center rounded-full text-fg glass'>
        {icon}
      </div>
      <div className='space-y-1'>
        <h3 className='text-sm font-semibold text-fg'>{title}</h3>
        <p className='mx-auto max-w-xs text-[13px] leading-relaxed text-muted-fg'>
          {desc}
        </p>
      </div>
      {action}
    </div>
  );
}
