import { Link } from 'react-router';
import { Button } from '@/shared/ui/button';

export function NotFoundPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Página no encontrada</h1>
      <Button asChild variant="outline">
        <Link to="/conversations">Ir a conversaciones</Link>
      </Button>
    </div>
  );
}
