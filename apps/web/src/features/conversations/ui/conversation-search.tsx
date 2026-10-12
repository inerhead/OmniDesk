import { Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Input } from '@/shared/ui/input';
import { normalizeSearch } from '../model/search';

const DEBOUNCE_MS = 300;

/** Buscador por nombre o teléfono. Tras 300 ms sin teclear, refleja el término en `?q=`. */
export function ConversationSearch() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlQ = searchParams.get('q') ?? '';
  const [text, setText] = useState(urlQ);

  // La URL cambió por fuera (atrás/adelante, un enlace): el campo la sigue.
  const [syncedQ, setSyncedQ] = useState(urlQ);
  if (urlQ !== syncedQ) {
    setSyncedQ(urlQ);
    if (normalizeSearch(text) !== normalizeSearch(urlQ)) setText(urlQ);
  }

  useEffect(() => {
    const next = normalizeSearch(text);
    if (next === normalizeSearch(urlQ)) return;
    const timer = setTimeout(() => {
      setSearchParams(
        (previous) => {
          const params = new URLSearchParams(previous);
          if (next) params.set('q', next);
          else params.delete('q');
          return params;
        },
        { replace: true },
      );
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, urlQ, setSearchParams]);

  return (
    <div className="relative">
      <Search
        className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
        aria-hidden
      />
      <Input
        type="search"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setText('');
        }}
        placeholder="Buscar por nombre o teléfono"
        aria-label="Buscar conversaciones por nombre o teléfono"
        maxLength={100}
        className="bg-muted/50 rounded-lg pr-8 pl-9 [&::-webkit-search-cancel-button]:hidden"
      />
      {text && (
        <button
          type="button"
          aria-label="Borrar búsqueda"
          onClick={() => setText('')}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 absolute top-1/2 right-2 -translate-y-1/2 rounded-sm p-0.5 outline-none focus-visible:ring-[3px]"
        >
          <X className="size-4" aria-hidden />
        </button>
      )}
    </div>
  );
}
