import { Compass } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';

export function NotFoundPage() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <EmptyState
        icon={Compass}
        title={<span className="text-2xl font-semibold tracking-tight">Página no encontrada</span>}
        description="La dirección no existe o ya no está disponible."
        action={
          <Button asChild variant="outline">
            <Link to="/conversations">Ir a conversaciones</Link>
          </Button>
        }
      />
    </div>
  );
}
