import { useState, type ComponentProps } from 'react';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';

export function Field({ label, ...props }: ComponentProps<typeof Input> & { label: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span>{label}</span>
      <Input {...props} />
    </label>
  );
}

export function CopyValue({ label, value }: { label: string; value: string }) {
  const [notice, setNotice] = useState('');
  return (
    <div className="flex flex-col gap-2">
      <Field label={label} value={value} readOnly />
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void navigator.clipboard
              .writeText(value)
              .then(() => setNotice('Copiado'))
              .catch(() => setNotice('No se pudo copiar; selecciona el texto.'));
          }}
        >
          Copiar {label}
        </Button>
        <span role="status" className="text-xs">
          {notice}
        </span>
      </div>
    </div>
  );
}
