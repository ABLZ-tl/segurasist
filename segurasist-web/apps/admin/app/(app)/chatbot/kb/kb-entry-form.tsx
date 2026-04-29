'use client';

/**
 * Sprint 5 — S5-3 finisher.
 *
 * <KbEntryForm /> — drawer/dialog que crea o edita una entry de KB.
 *
 * UX:
 *   - Sheet (slide-in desde la derecha) en desktop ≥ md; full-height.
 *   - react-hook-form + zod resolver (mismo schema que el BE Zod, pegado a
 *     mano para no acoplar el FE al package del API; los tests cubren la
 *     paridad de validación).
 *   - Campos:
 *       intent  → slug input con regex hint
 *       title   → input plain
 *       body    → textarea ampliada (12 rows, hint markdown)
 *       keywords→ chip-input (Enter / coma agrega; backspace borra última)
 *       priority→ number 0-100
 *       enabled → toggle visual (input checkbox sized + ring shift)
 *   - Errores inline bajo cada control (no toasts globales — UX de form).
 *
 * Datos:
 *   - Modo create: `entry === null`. Submit llama `useCreateKbEntry`.
 *   - Modo edit:   `entry !== null`. Submit llama `useUpdateKbEntry(id)`.
 *   - Toast success/error con Lordicon "checkmark-success".
 *
 * No incluye el `<KbTestMatch />` aquí — está como panel inline lateral
 * para no acoplar el form (el match-test sólo aplica a entries persistidas
 * con `id`). Se renderiza en `kb-list-client.tsx` cuando hay entry editada.
 */

import * as React from 'react';
import { z } from 'zod';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { X as XIcon } from 'lucide-react';
import {
  Button,
  Input,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Textarea,
  toast,
} from '@segurasist/ui';
import {
  useCreateKbEntry,
  useUpdateKbEntry,
  type KbEntryAdmin,
} from '@segurasist/api-client/hooks/admin-chatbot-kb';
import { KbIcon } from './_lordicons';

const INTENT_RE = /^[a-z][a-z0-9-]*$/;

const KbEntryFormSchema = z.object({
  intent: z
    .string()
    .trim()
    .min(1, 'Intent es obligatorio')
    .max(40, 'Máximo 40 caracteres')
    .regex(INTENT_RE, 'Slug lowercase con guiones (a-z, 0-9, -)'),
  title: z
    .string()
    .trim()
    .min(1, 'Título obligatorio')
    .max(120, 'Máximo 120 caracteres'),
  body: z
    .string()
    .trim()
    .min(1, 'El cuerpo no puede estar vacío')
    .max(4000, 'Máximo 4000 caracteres'),
  keywords: z
    .array(z.string().trim().min(1).max(80))
    .min(1, 'Agrega al menos 1 keyword')
    .max(50, 'Máximo 50 keywords'),
  priority: z.coerce
    .number()
    .int('Sólo enteros')
    .min(0, '0 mínimo')
    .max(100, '100 máximo'),
  enabled: z.boolean(),
});

type KbEntryFormValues = z.infer<typeof KbEntryFormSchema>;

const DEFAULT_VALUES: KbEntryFormValues = {
  intent: '',
  title: '',
  body: '',
  keywords: [],
  priority: 0,
  enabled: true,
};

export interface KbEntryFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = modo create; entry = modo edit. */
  entry: KbEntryAdmin | null;
}

export function KbEntryForm({ open, onOpenChange, entry }: KbEntryFormProps): JSX.Element {
  const createMut = useCreateKbEntry();
  const updateMut = useUpdateKbEntry(entry?.id ?? '');
  const isEdit = !!entry;

  const form = useForm<KbEntryFormValues>({
    resolver: zodResolver(KbEntryFormSchema),
    mode: 'onChange',
    defaultValues: DEFAULT_VALUES,
  });

  // Re-siembra cuando cambia la entry o se abre el sheet en modo create.
  React.useEffect(() => {
    if (!open) return;
    if (entry) {
      form.reset({
        intent: entry.intent,
        title: entry.title,
        body: entry.body,
        keywords: entry.keywords,
        priority: entry.priority,
        enabled: entry.enabled,
      });
    } else {
      form.reset(DEFAULT_VALUES);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entry?.id]);

  const isPending = createMut.isPending || updateMut.isPending;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      if (isEdit && entry) {
        await updateMut.mutateAsync({
          intent: values.intent,
          title: values.title,
          body: values.body,
          keywords: values.keywords,
          priority: values.priority,
          enabled: values.enabled,
        });
        toast.success('Entrada actualizada', {
          icon: <KbIcon kind="saveSuccess" trigger="in" size={20} />,
        });
      } else {
        await createMut.mutateAsync({
          intent: values.intent,
          title: values.title,
          body: values.body,
          keywords: values.keywords,
          priority: values.priority,
          enabled: values.enabled,
        });
        toast.success('Entrada creada', {
          icon: <KbIcon kind="saveSuccess" trigger="in" size={20} />,
        });
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(isEdit ? 'No se pudo actualizar' : 'No se pudo crear', {
        description:
          e instanceof Error ? e.message : 'Inténtalo de nuevo en unos segundos.',
      });
    }
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full max-w-2xl overflow-y-auto sm:max-w-2xl"
        data-testid="kb-entry-form-sheet"
      >
        <SheetHeader>
          <SheetTitle>{isEdit ? 'Editar entrada' : 'Nueva entrada'}</SheetTitle>
          <SheetDescription>
            {isEdit
              ? 'Ajusta los campos de esta entrada de la base de conocimiento.'
              : 'Crea una nueva entrada para entrenar al chatbot.'}
          </SheetDescription>
        </SheetHeader>

        <form
          onSubmit={onSubmit}
          data-testid="kb-entry-form"
          className="mt-6 space-y-5"
          noValidate
        >
          {/* Intent */}
          <Field
            id="kb-intent"
            label="Intent (slug)"
            error={form.formState.errors.intent?.message}
            hint="Identificador único del intent. Ej: cobertura-emergencias"
          >
            <Input
              id="kb-intent"
              data-testid="kb-intent"
              {...form.register('intent')}
              invalid={!!form.formState.errors.intent}
              maxLength={40}
              autoComplete="off"
              placeholder="cobertura-emergencias"
            />
          </Field>

          {/* Title */}
          <Field
            id="kb-title"
            label="Título"
            error={form.formState.errors.title?.message}
            hint="Visible en el editor; no se muestra al asegurado."
          >
            <Input
              id="kb-title"
              data-testid="kb-title"
              {...form.register('title')}
              invalid={!!form.formState.errors.title}
              maxLength={120}
              autoComplete="off"
            />
          </Field>

          {/* Body */}
          <Field
            id="kb-body"
            label="Cuerpo (Markdown)"
            error={form.formState.errors.body?.message}
            hint="Soporta Markdown. Lo verá el asegurado en el chat."
          >
            <Textarea
              id="kb-body"
              data-testid="kb-body"
              {...form.register('body')}
              invalid={!!form.formState.errors.body}
              maxLength={4000}
              rows={10}
              className="min-h-[220px] font-mono text-[13px] leading-relaxed"
            />
          </Field>

          {/* Keywords */}
          <Field
            id="kb-keywords-input"
            label="Keywords"
            error={form.formState.errors.keywords?.message}
            hint="Enter o coma agrega un chip. Backspace en input vacío borra el último."
          >
            <Controller
              control={form.control}
              name="keywords"
              render={({ field, fieldState }) => (
                <KeywordsChipInput
                  value={field.value}
                  onChange={field.onChange}
                  invalid={!!fieldState.error}
                />
              )}
            />
          </Field>

          {/* Priority + Enabled */}
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              id="kb-priority"
              label="Prioridad (0-100)"
              error={form.formState.errors.priority?.message}
              hint="Más alto = prioritario en el matcher."
            >
              <Input
                id="kb-priority"
                data-testid="kb-priority"
                type="number"
                min={0}
                max={100}
                {...form.register('priority')}
                invalid={!!form.formState.errors.priority}
              />
            </Field>

            <div className="space-y-1.5">
              <span className="block text-sm font-medium text-fg">Habilitada</span>
              <Controller
                control={form.control}
                name="enabled"
                render={({ field }) => (
                  <EnabledToggle
                    value={field.value}
                    onChange={field.onChange}
                    testId="kb-enabled"
                  />
                )}
              />
              <p className="text-xs text-fg-muted">
                Si está deshabilitada, el matcher la ignora.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              data-testid="kb-submit"
              loading={isPending}
              disabled={isPending}
            >
              {isEdit ? 'Guardar cambios' : 'Crear entrada'}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

interface FieldProps {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}

function Field({ id, label, error, hint, children }: FieldProps): JSX.Element {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-fg">
        {label}
      </label>
      {children}
      {error && (
        <p
          role="alert"
          data-testid={`${id}-error`}
          className="text-sm font-medium text-danger"
        >
          {error}
        </p>
      )}
      {!error && hint && <p className="text-xs text-fg-muted">{hint}</p>}
    </div>
  );
}

interface KeywordsChipInputProps {
  value: string[];
  onChange: (next: string[]) => void;
  invalid?: boolean;
}

function KeywordsChipInput({
  value,
  onChange,
  invalid,
}: KeywordsChipInputProps): JSX.Element {
  const [draft, setDraft] = React.useState('');

  const add = (raw: string): void => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    if (trimmed.length > 80) return;
    if (value.includes(trimmed)) return;
    if (value.length >= 50) return;
    onChange([...value, trimmed]);
    setDraft('');
  };

  const removeAt = (idx: number): void => {
    onChange(value.filter((_, i) => i !== idx));
  };

  return (
    <div
      data-testid="kb-keywords"
      data-invalid={invalid ? 'true' : 'false'}
      className={[
        'flex min-h-[42px] flex-wrap items-center gap-1.5 rounded-md border bg-bg px-2 py-1.5 text-sm',
        invalid ? 'border-danger' : 'border-border',
      ].join(' ')}
    >
      {value.map((kw, idx) => (
        <span
          key={`${kw}-${idx}`}
          data-testid="kb-keyword-chip"
          className="inline-flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-xs text-fg"
        >
          {kw}
          <button
            type="button"
            aria-label={`Eliminar ${kw}`}
            data-testid="kb-keyword-remove"
            onClick={() => removeAt(idx)}
            className="rounded-full p-0.5 text-fg-muted transition-colors hover:bg-bg-elevated hover:text-fg"
          >
            <XIcon className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        id="kb-keywords-input"
        data-testid="kb-keywords-input"
        type="text"
        className="min-w-[8rem] flex-1 bg-transparent px-1 py-0.5 text-sm outline-none"
        placeholder={value.length === 0 ? 'Escribe y pulsa Enter' : ''}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add(draft);
          } else if (e.key === 'Backspace' && draft.length === 0 && value.length > 0) {
            e.preventDefault();
            removeAt(value.length - 1);
          }
        }}
        onBlur={() => {
          if (draft.trim()) add(draft);
        }}
      />
    </div>
  );
}

interface EnabledToggleProps {
  value: boolean;
  onChange: (next: boolean) => void;
  testId?: string;
}

function EnabledToggle({ value, onChange, testId }: EnabledToggleProps): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      data-testid={testId}
      data-state={value ? 'on' : 'off'}
      onClick={() => onChange(!value)}
      className={[
        'inline-flex h-7 w-12 items-center rounded-full border transition-all duration-200',
        value
          ? 'border-success/40 bg-success/15 ring-2 ring-success/30'
          : 'border-border bg-surface ring-2 ring-transparent',
      ].join(' ')}
    >
      <span
        className={[
          'inline-block h-5 w-5 rounded-full bg-bg shadow transition-transform duration-200',
          value ? 'translate-x-6' : 'translate-x-1',
        ].join(' ')}
      />
      <span className="sr-only">{value ? 'Habilitada' : 'Deshabilitada'}</span>
    </button>
  );
}
