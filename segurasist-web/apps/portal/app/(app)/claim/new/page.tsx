'use client';

/**
 * Portal asegurado — Reportar siniestro/evento.
 *
 * Form RHF + Zod. Validación inline (no modales). Confirmación post-submit
 * en estado local (no nav) para que el usuario vea el ticket # antes de
 * irse. La promesa "MAC se pone en contacto en 48 horas hábiles" es UX
 * copy del FE — no estado del backend.
 *
 * Decisiones:
 * - native `<input type="date">` con styling: el DatePicker de @segurasist/ui
 *   funciona bien en desktop pero en mobile el OS picker nativo es mejor UX
 *   y no requiere overlay (un tap menos). Min/max enforced via attrs y zod.
 * - Contador chars en vivo (controlled `<Textarea>`).
 * - Toast en error (Sonner).
 */

import * as React from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  CheckCircle,
  HelpCircle,
  Pill,
  Smile,
  Stethoscope,
  type LucideIcon,
} from 'lucide-react';
import {
  Button,
  Card,
  CardContent,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  toast,
} from '@segurasist/ui';
import { useCreateClaimSelf } from '@segurasist/api-client/hooks/claims';
import type {
  ClaimResult,
  ClaimType,
} from '@segurasist/api-client/hooks/claims';
import { ProblemDetailsError } from '@segurasist/api-client';

const MAX_DESC = 500;
const MIN_DESC = 10;

const TODAY = () => new Date().toISOString().slice(0, 10);
const ONE_YEAR_AGO = () => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
};

const schema = z.object({
  type: z.enum(['medical', 'dental', 'pharmacy', 'other'], {
    errorMap: () => ({ message: 'Selecciona el tipo de evento' }),
  }),
  occurredAt: z
    .string()
    .min(1, 'Selecciona la fecha del evento')
    .refine((v) => v <= TODAY(), {
      message: 'La fecha no puede ser futura',
    })
    .refine((v) => v >= ONE_YEAR_AGO(), {
      message: 'La fecha debe ser dentro del último año',
    }),
  description: z
    .string()
    .min(MIN_DESC, `Describe brevemente lo ocurrido (mínimo ${MIN_DESC} caracteres)`)
    .max(MAX_DESC, `Máximo ${MAX_DESC} caracteres`),
});

type FormValues = z.infer<typeof schema>;

interface ClaimTypeOption {
  value: ClaimType;
  label: string;
  icon: LucideIcon;
}

const CLAIM_TYPES: ClaimTypeOption[] = [
  { value: 'medical', label: 'Médico', icon: Stethoscope },
  { value: 'dental', label: 'Dental', icon: Smile },
  { value: 'pharmacy', label: 'Farmacia', icon: Pill },
  { value: 'other', label: 'Otro', icon: HelpCircle },
];

export default function NewClaimPage() {
  const [submitted, setSubmitted] = React.useState<ClaimResult | null>(null);
  const mutation = useCreateClaimSelf();

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isValid },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onChange',
    // `type` queda sin definir hasta que el usuario elige (controlled por el
    // Select de Radix vía `setValue`). `DefaultValues<T>` admite parciales,
    // así que omitir `type` es válido.
    defaultValues: {
      occurredAt: '',
      description: '',
    },
  });

  const description = watch('description') ?? '';
  const selectedType = watch('type');

  const onSubmit = handleSubmit(async (values) => {
    try {
      const result = await mutation.mutateAsync(values);
      setSubmitted(result);
      toast.success('Reporte enviado correctamente');
    } catch (err) {
      const msg =
        err instanceof ProblemDetailsError
          ? err.message
          : 'No pudimos enviar el reporte. Inténtalo de nuevo.';
      toast.error(msg);
    }
  });

  if (submitted) {
    return <ClaimSuccess result={submitted} />;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="mx-auto max-w-md space-y-4 px-4 pb-8 pt-4 md:max-w-2xl"
      data-testid="claim-form-page"
    >
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Reportar siniestro</h1>
        <p className="text-sm text-fg-muted">
          MAC se pondrá en contacto contigo en 48 horas hábiles.
        </p>
      </header>

      <Card>
        <CardContent className="p-4">
          <form
            onSubmit={onSubmit}
            className="space-y-5"
            noValidate
            data-testid="claim-form"
          >
            <div className="space-y-1.5">
              <label htmlFor="claim-type" className="text-sm font-medium">
                Tipo de evento
              </label>
              <Select
                value={selectedType}
                onValueChange={(v: string) =>
                  setValue('type', v as ClaimType, {
                    shouldValidate: true,
                    shouldDirty: true,
                  })
                }
              >
                <SelectTrigger
                  id="claim-type"
                  aria-label="Tipo de evento"
                  aria-invalid={!!errors.type || undefined}
                  aria-describedby={errors.type ? 'claim-type-err' : undefined}
                  data-testid="claim-type-trigger"
                >
                  <SelectValue placeholder="Selecciona..." />
                </SelectTrigger>
                <SelectContent>
                  {CLAIM_TYPES.map(({ value, label, icon: Icon }) => (
                    <SelectItem key={value} value={value}>
                      <span className="flex items-center gap-2">
                        <Icon aria-hidden className="h-4 w-4" />
                        {label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.type && (
                <p
                  id="claim-type-err"
                  role="alert"
                  className="text-xs text-danger"
                >
                  {errors.type.message}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="claim-date" className="text-sm font-medium">
                Fecha del evento
              </label>
              <Input
                id="claim-date"
                type="date"
                max={TODAY()}
                min={ONE_YEAR_AGO()}
                aria-invalid={!!errors.occurredAt || undefined}
                aria-describedby={
                  errors.occurredAt ? 'claim-date-err' : undefined
                }
                data-testid="claim-date-input"
                {...register('occurredAt')}
              />
              {errors.occurredAt && (
                <p
                  id="claim-date-err"
                  role="alert"
                  className="text-xs text-danger"
                >
                  {errors.occurredAt.message}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="claim-desc" className="text-sm font-medium">
                Descripción
              </label>
              <Textarea
                id="claim-desc"
                rows={4}
                maxLength={MAX_DESC}
                placeholder="Describe brevemente lo ocurrido..."
                invalid={!!errors.description}
                aria-describedby={
                  errors.description ? 'claim-desc-err' : 'claim-desc-counter'
                }
                className="resize-y"
                data-testid="claim-desc-input"
                {...register('description')}
              />
              <div className="flex items-center justify-between">
                {errors.description ? (
                  <p
                    id="claim-desc-err"
                    role="alert"
                    className="text-xs text-danger"
                  >
                    {errors.description.message}
                  </p>
                ) : (
                  <span />
                )}
                <p
                  id="claim-desc-counter"
                  className="text-right text-xs text-fg-muted"
                  data-testid="claim-desc-counter"
                  aria-live="polite"
                >
                  {description.length}/{MAX_DESC}
                </p>
              </div>
            </div>

            <Button
              type="submit"
              size="lg"
              className="h-14 w-full text-base"
              disabled={!isValid || mutation.isPending}
              loading={mutation.isPending}
              loadingText="Enviando..."
              data-testid="claim-submit"
            >
              Enviar reporte
            </Button>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function ClaimSuccess({ result }: { result: ClaimResult }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 pb-8 pt-12 text-center"
      data-testid="claim-success"
    >
      <CheckCircle aria-hidden className="h-16 w-16 text-success" />
      <h1 className="text-2xl font-bold">¡Reporte enviado!</h1>
      <p className="text-sm text-fg-muted">
        Ticket{' '}
        <span
          className="font-mono font-semibold text-fg"
          data-testid="claim-ticket"
        >
          #{result.ticketNumber}
        </span>
      </p>
      <p className="text-sm text-fg">
        MAC se pondrá en contacto contigo en{' '}
        <span className="font-medium">48 horas hábiles</span>.
      </p>
      <Button asChild size="lg" className="mt-4 h-14 w-full text-base">
        <Link href="/">Volver a inicio</Link>
      </Button>
    </motion.div>
  );
}
