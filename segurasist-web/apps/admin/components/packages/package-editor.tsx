'use client';

/**
 * S2-02 — PackageEditor.
 *
 * Form para crear/editar un Package + sus coverages embebidas. Validación
 * client-side con Zod (mismo schema que el backend) y submit con TanStack
 * Query mutation. Optimistic update via invalidateQueries.
 *
 * Sin dependencias react-hook-form ni @hookform/resolvers para mantener
 * el bundle ligero y evitar instalar deps. Usamos useState + un parser
 * Zod manual al submit. Este patron lo seguimos en otros editores del
 * admin app (login, etc.).
 */

import * as React from 'react';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { Button, Input } from '@segurasist/ui';

function Label({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="text-[12px] font-medium text-fg-muted">
      {children}
    </label>
  );
}
import { Trash2, Plus } from 'lucide-react';
import { api } from '@segurasist/api-client';

const CoverageInputSchema = z
  .object({
    name: z.string().min(2, 'Mínimo 2 caracteres').max(120),
    type: z.enum(['count', 'amount']),
    limitCount: z
      .union([z.number().int().positive(), z.nan()])
      .optional()
      .transform((v) => (typeof v === 'number' && !Number.isNaN(v) ? v : undefined)),
    limitAmount: z
      .union([z.number().positive(), z.nan()])
      .optional()
      .transform((v) => (typeof v === 'number' && !Number.isNaN(v) ? v : undefined)),
    unit: z.string().min(1).max(20),
    description: z.string().max(500).nullish(),
  })
  .refine((c) => (c.type === 'count' ? typeof c.limitCount === 'number' : true), {
    message: 'limitCount es requerido cuando type=count',
    path: ['limitCount'],
  })
  .refine((c) => (c.type === 'amount' ? typeof c.limitAmount === 'number' : true), {
    message: 'limitAmount es requerido cuando type=amount',
    path: ['limitAmount'],
  });

const PackageInputSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(1000).nullish(),
  status: z.enum(['active', 'archived']).default('active'),
  coverages: z.array(CoverageInputSchema).max(40).default([]),
});

export type PackageInput = z.infer<typeof PackageInputSchema>;

interface CoverageDraft {
  id: string; // local UUID for React key
  name: string;
  type: 'count' | 'amount';
  limitCount: string;
  limitAmount: string;
  unit: string;
  description: string;
}

interface PackageEditorProps {
  initial?: Partial<PackageInput> & { id?: string };
  onSaved?: () => void;
}

export function PackageEditor({ initial, onSaved }: PackageEditorProps): JSX.Element {
  const [name, setName] = React.useState(initial?.name ?? '');
  const [description, setDescription] = React.useState(initial?.description ?? '');
  const [coverages, setCoverages] = React.useState<CoverageDraft[]>(
    (initial?.coverages ?? []).map((c, i) => ({
      id: `c-${i}`,
      name: c.name,
      type: c.type,
      limitCount: c.limitCount?.toString() ?? '',
      limitAmount: c.limitAmount?.toString() ?? '',
      unit: c.unit,
      description: c.description ?? '',
    })),
  );
  const [errors, setErrors] = React.useState<string[]>([]);

  const mutation = useMutation({
    mutationFn: (input: PackageInput) => {
      const path = initial?.id ? `/v1/packages/${initial.id}` : '/v1/packages';
      const method = initial?.id ? 'PATCH' : 'POST';
      return api(path, { method, body: JSON.stringify(input) });
    },
    onSuccess: () => onSaved?.(),
  });

  function addCoverage() {
    setCoverages((cs) => [
      ...cs,
      {
        id: `c-${Date.now()}`,
        name: '',
        type: 'count',
        limitCount: '',
        limitAmount: '',
        unit: 'unidades',
        description: '',
      },
    ]);
  }

  function removeCoverage(id: string) {
    setCoverages((cs) => cs.filter((c) => c.id !== id));
  }

  function updateCoverage<K extends keyof CoverageDraft>(id: string, key: K, value: CoverageDraft[K]) {
    setCoverages((cs) => cs.map((c) => (c.id === id ? { ...c, [key]: value } : c)));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const candidate = {
      name,
      description: description || null,
      status: 'active' as const,
      coverages: coverages.map((c) => ({
        name: c.name,
        type: c.type,
        limitCount: c.type === 'count' ? Number(c.limitCount) : undefined,
        limitAmount: c.type === 'amount' ? Number(c.limitAmount) : undefined,
        unit: c.unit,
        description: c.description || null,
      })),
    };
    const parsed = PackageInputSchema.safeParse(candidate);
    if (!parsed.success) {
      setErrors(parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`));
      return;
    }
    setErrors([]);
    mutation.mutate(parsed.data);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 py-2">
      <div className="space-y-1.5">
        <Label htmlFor="pkg-name">Nombre</Label>
        <Input id="pkg-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pkg-desc">Descripción</Label>
        <Input
          id="pkg-desc"
          value={description ?? ''}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <fieldset className="space-y-3">
        <legend className="text-[12px] font-medium uppercase tracking-wider text-fg-subtle">
          Coberturas
        </legend>
        {coverages.map((c) => (
          <div key={c.id} className="rounded-md border border-border p-3 space-y-2">
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1">
                <Label>Nombre</Label>
                <Input value={c.name} onChange={(e) => updateCoverage(c.id, 'name', e.target.value)} />
              </div>
              <div className="w-28 space-y-1">
                <Label>Tipo</Label>
                <select
                  value={c.type}
                  onChange={(e) =>
                    updateCoverage(c.id, 'type', e.target.value as 'count' | 'amount')
                  }
                  className="block h-9 w-full rounded-md border border-border bg-bg px-2 text-[13px]"
                >
                  <option value="count">Conteo</option>
                  <option value="amount">Monto</option>
                </select>
              </div>
              <Button
                type="button"
                variant="ghost"
                aria-label="Eliminar cobertura"
                onClick={() => removeCoverage(c.id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {c.type === 'count' ? (
                <div className="space-y-1">
                  <Label>Límite (#)</Label>
                  <Input
                    type="number"
                    min="1"
                    value={c.limitCount}
                    onChange={(e) => updateCoverage(c.id, 'limitCount', e.target.value)}
                  />
                </div>
              ) : (
                <div className="space-y-1">
                  <Label>Límite (MXN)</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={c.limitAmount}
                    onChange={(e) => updateCoverage(c.id, 'limitAmount', e.target.value)}
                  />
                </div>
              )}
              <div className="space-y-1">
                <Label>Unidad</Label>
                <Input value={c.unit} onChange={(e) => updateCoverage(c.id, 'unit', e.target.value)} />
              </div>
            </div>
          </div>
        ))}
        <Button type="button" variant="secondary" onClick={addCoverage}>
          <Plus aria-hidden className="mr-2 h-4 w-4" />
          Agregar cobertura
        </Button>
      </fieldset>

      {errors.length > 0 && (
        <ul className="rounded-md border border-danger/30 bg-danger/10 p-3 text-[13px] text-danger space-y-1">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="submit" loading={mutation.isPending}>
          {initial?.id ? 'Guardar cambios' : 'Crear paquete'}
        </Button>
      </div>
    </form>
  );
}
