import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { TooltipProvider } from '@/shared/ui/tooltip';
import { RealtimeProvider } from './realtime-provider';

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <RealtimeProvider>
        <TooltipProvider>{children}</TooltipProvider>
      </RealtimeProvider>
    </QueryClientProvider>
  );
}
