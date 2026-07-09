import { Toaster as SonnerToaster, toast } from 'sonner';

export function Toaster({
  position = 'top-center',
}: {
  position?: 'top-center' | 'bottom-right';
}) {
  return (
    <SonnerToaster
      position={position}
      toastOptions={{
        classNames: {
          toast: 'group text-fg rounded-xl glass text-[13px]',
          description: 'text-muted-fg',
          actionButton: 'bg-primary text-primary-fg',
        },
      }}
    />
  );
}

export { toast };
