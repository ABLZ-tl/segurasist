'use client';

/**
 * Sprint 5 — MT-2 iter 1 + iter 2 (CC-21 swap stubs → @segurasist/ui).
 *
 * <BrandingEditor /> — editor de branding del tenant.
 *
 * Layout:
 *   - Desktop ≥ lg: 2 columnas (form 5/12, preview 7/12 sticky).
 *   - Mobile/tablet: stack (form arriba, preview abajo).
 *
 * Form:
 *   - react-hook-form + @hookform/resolvers/zod (deps ya en admin).
 *   - Validación inline (FormError debajo de cada input — NO alert global).
 *   - Botón "Guardar" disabled si !isDirty || !isValid || !mutation.idle.
 *   - Botón "Restaurar default" abre <Dialog> de confirmación.
 *
 * react-query:
 *   - `useTenantBranding(tenantId)` — fuente de verdad inicial.
 *   - `useUpdateBrandingMutation` — invalida tenant-branding + portal-self.
 *   - `useUploadLogoMutation` / `useDeleteLogoMutation` — multipart + DELETE.
 *
 * Contratos consumidos (publicados por MT-1, ver DISPATCH_PLAN sección
 * "Contratos a publicar en iter 1"):
 *   - `GET /v1/admin/tenants/:id/branding` → TenantBranding
 *   - `PUT /v1/admin/tenants/:id/branding` (DTO sin logoUrl)
 *   - `POST /v1/admin/tenants/:id/branding/logo` (multipart)
 *   - `DELETE /v1/admin/tenants/:id/branding/logo`
 *
 * UX:
 *   - Skeleton en loading (no spinner genérico).
 *   - Pill arriba: "Última actualización: hace X" (date-fns es).
 *   - Toast success post-save con Lordicon "checkmark-success".
 *   - Lordicon "palette" en header (consumido desde @segurasist/ui en iter 2).
 *   - Lordicon "arrow-loading" dentro del botón Guardar cuando isSubmitting.
 */

import * as React from 'react';
import { z } from 'zod';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Input,
  Skeleton,
  Section,
  AlertBanner,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  toast,
  LordIcon,
  GsapFade,
  GsapStagger,
} from '@segurasist/ui';
import {
  useTenantBranding,
  useUpdateBrandingMutation,
  useUploadLogoMutation,
  useDeleteLogoMutation,
  type TenantBranding,
} from '@segurasist/api-client/hooks/admin-tenants';
import { ColorPickerCard } from './color-picker-card';
import { LogoDropzone } from './logo-dropzone';
import { PreviewPane } from './preview-pane';
import { isValidHex } from './_contrast';

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

const BrandingFormSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, 'El nombre comercial es obligatorio')
    .max(80, 'Máximo 80 caracteres'),
  tagline: z
    .string()
    .trim()
    .max(160, 'Máximo 160 caracteres')
    .optional()
    .or(z.literal('')),
  primaryHex: z
    .string()
    .regex(HEX_RE, 'Formato hex inválido (esperado #rrggbb)'),
  accentHex: z
    .string()
    .regex(HEX_RE, 'Formato hex inválido (esperado #rrggbb)'),
  bgImageUrl: z
    .string()
    .trim()
    .url('Debe ser una URL válida (https://...)')
    .max(500)
    .optional()
    .or(z.literal('')),
});

type BrandingFormValues = z.infer<typeof BrandingFormSchema>;

const DEFAULT_BRANDING: BrandingFormValues = {
  displayName: 'SegurAsist',
  tagline: 'Tu seguro de salud, simple.',
  primaryHex: '#1f3a8a',
  accentHex: '#3b82f6',
  bgImageUrl: '',
};

function brandingToForm(b: TenantBranding): BrandingFormValues {
  return {
    displayName: b.displayName,
    tagline: b.tagline ?? '',
    primaryHex: b.primaryHex,
    accentHex: b.accentHex,
    bgImageUrl: b.bgImageUrl ?? '',
  };
}

export interface BrandingEditorProps {
  tenantId: string;
}

export function BrandingEditor({ tenantId }: BrandingEditorProps): JSX.Element {
  const { data, isLoading, isError, error } = useTenantBranding(tenantId);
  const updateMutation = useUpdateBrandingMutation(tenantId);
  const uploadMutation = useUploadLogoMutation(tenantId);
  const deleteMutation = useDeleteLogoMutation(tenantId);

  const [confirmRestore, setConfirmRestore] = React.useState(false);
  const [logoPreview, setLogoPreview] = React.useState<string | null>(null);

  const form = useForm<BrandingFormValues>({
    resolver: zodResolver(BrandingFormSchema),
    mode: 'onChange',
    defaultValues: DEFAULT_BRANDING,
  });

  // Cuando llega el GET inicial, sembramos el form. `reset` no marca dirty.
  React.useEffect(() => {
    if (data) form.reset(brandingToForm(data));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.tenantId, data?.lastUpdatedAt]);

  // Live values para el preview.
  const watched = form.watch();

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await updateMutation.mutateAsync({
        displayName: values.displayName,
        tagline: values.tagline ? values.tagline : null,
        primaryHex: values.primaryHex,
        accentHex: values.accentHex,
        bgImageUrl: values.bgImageUrl ? values.bgImageUrl : null,
      });
      toast.success('Branding actualizado', {
        description: 'Los cambios se aplicarán al portal de tus asegurados.',
        icon: <LordIcon name="checkmark-success" trigger="in" size={20} />,
      });
      form.reset(values, { keepValues: true });
    } catch (e) {
      toast.error('No se pudo guardar', {
        description:
          e instanceof Error ? e.message : 'Inténtalo de nuevo en unos segundos.',
      });
    }
  });

  const onUploadLogo = (file: File) => {
    // Optimistic preview local mientras sube.
    const localUrl = URL.createObjectURL(file);
    setLogoPreview(localUrl);
    uploadMutation.mutate(file, {
      onSuccess: () => {
        toast.success('Logotipo subido', {
          icon: <LordIcon name="checkmark-success" trigger="in" size={20} />,
        });
        // El refetch del GET pinta la URL definitiva; liberamos el blob.
        setTimeout(() => {
          URL.revokeObjectURL(localUrl);
          setLogoPreview(null);
        }, 1500);
      },
      onError: (err) => {
        setLogoPreview(null);
        URL.revokeObjectURL(localUrl);
        toast.error('Error al subir el logotipo', {
          description: err instanceof Error ? err.message : undefined,
        });
      },
    });
  };

  const onDeleteLogo = () => {
    deleteMutation.mutate(undefined, {
      onSuccess: () =>
        toast.success('Logotipo eliminado', {
          icon: <LordIcon name="checkmark-success" trigger="in" size={20} />,
        }),
      onError: (err) =>
        toast.error('No se pudo eliminar el logotipo', {
          description: err instanceof Error ? err.message : undefined,
        }),
    });
  };

  const onRestoreDefault = () => {
    // `keepDefaultValues: true` mantiene los defaults originales (data del
    // servidor) como referencia, mientras pisa los values actuales con los
    // de marca. Eso deja `isDirty=true` para habilitar Guardar inmediatamente.
    form.reset(DEFAULT_BRANDING, { keepDefaultValues: true });
    setConfirmRestore(false);
    toast.info('Valores restaurados — recuerda guardar para aplicar.');
  };

  if (isLoading) {
    return (
      <div data-testid="branding-editor-skeleton" className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-6 lg:grid-cols-12">
          <div className="space-y-4 lg:col-span-5">
            <Skeleton className="h-44 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
          <div className="lg:col-span-7">
            <Skeleton className="h-[420px] w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <AlertBanner tone="danger" title="No pudimos cargar el branding">
        {error instanceof Error
          ? error.message
          : 'Reintenta en unos segundos. Si persiste, contacta a soporte.'}
      </AlertBanner>
    );
  }

  const lastUpdated = data?.lastUpdatedAt
    ? formatDistanceToNow(new Date(data.lastUpdatedAt), {
        addSuffix: true,
        locale: es,
      })
    : null;

  const canSave =
    form.formState.isDirty &&
    form.formState.isValid &&
    !updateMutation.isPending;

  return (
    <GsapStagger className="space-y-5" staggerDelay={0.06}>
      <Section
        title={
          <span className="inline-flex items-center gap-2">
            <LordIcon name="palette" trigger="loop" size={22} />
            Branding del tenant
          </span>
        }
        description="Configura cómo se ve el portal del asegurado: logotipo, colores y mensaje principal."
        actions={
          <div className="flex items-center gap-2">
            {lastUpdated && (
              <span
                data-testid="branding-last-updated"
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-xs text-fg-muted"
              >
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-success" />
                Actualizado {lastUpdated}
              </span>
            )}
          </div>
        }
      />

      <form
        onSubmit={onSubmit}
        data-testid="branding-editor-form"
        className="grid gap-6 lg:grid-cols-12"
        noValidate
      >
        {/* Form column */}
        <div className="space-y-5 lg:col-span-5">
          <GsapFade>
            <Card>
              <CardHeader>
                <CardTitle>Identidad</CardTitle>
                <CardDescription>
                  Nombre comercial visible y un tagline opcional bajo el header.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <label
                    htmlFor="branding-displayName"
                    className="text-sm font-medium text-fg"
                  >
                    Nombre comercial *
                  </label>
                  <Input
                    id="branding-displayName"
                    data-testid="branding-displayName"
                    {...form.register('displayName')}
                    invalid={!!form.formState.errors.displayName}
                    aria-invalid={!!form.formState.errors.displayName}
                    aria-describedby="branding-displayName-error"
                    maxLength={80}
                    autoComplete="off"
                  />
                  {form.formState.errors.displayName && (
                    <p
                      id="branding-displayName-error"
                      role="alert"
                      data-testid="branding-displayName-error"
                      className="text-sm font-medium text-danger"
                    >
                      {form.formState.errors.displayName.message}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <label
                    htmlFor="branding-tagline"
                    className="text-sm font-medium text-fg"
                  >
                    Tagline
                  </label>
                  <Input
                    id="branding-tagline"
                    data-testid="branding-tagline"
                    {...form.register('tagline')}
                    invalid={!!form.formState.errors.tagline}
                    maxLength={160}
                    placeholder="Tu seguro al alcance, sin papeleo."
                    autoComplete="off"
                  />
                  {form.formState.errors.tagline && (
                    <p
                      role="alert"
                      data-testid="branding-tagline-error"
                      className="text-sm font-medium text-danger"
                    >
                      {form.formState.errors.tagline.message}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          </GsapFade>

          <GsapFade delay={0.06}>
            <Card>
              <CardHeader>
                <CardTitle>Logotipo</CardTitle>
                <CardDescription>
                  PNG, SVG o WebP. Máximo 512KB y 1024×1024 px.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <LogoDropzone
                  currentUrl={data?.logoUrl ?? null}
                  previewUrl={logoPreview}
                  onUpload={onUploadLogo}
                  onDelete={onDeleteLogo}
                  isUploading={uploadMutation.isPending}
                  isDeleting={deleteMutation.isPending}
                  remoteError={
                    uploadMutation.error instanceof Error
                      ? uploadMutation.error.message
                      : null
                  }
                />
              </CardContent>
            </Card>
          </GsapFade>

          <GsapFade delay={0.12}>
            <Card>
              <CardHeader>
                <CardTitle>Colores</CardTitle>
                <CardDescription>
                  Validamos el contraste contra fondo blanco (WCAG AA = 4.5:1).
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <Controller
                  name="primaryHex"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <ColorPickerCard
                      id="primary"
                      label="Color primario"
                      description="Botones, header y elementos de marca."
                      value={field.value}
                      onChange={field.onChange}
                      error={fieldState.error?.message}
                    />
                  )}
                />
                <Controller
                  name="accentHex"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <ColorPickerCard
                      id="accent"
                      label="Color de acento"
                      description="Links, badges y CTAs secundarios."
                      value={field.value}
                      onChange={field.onChange}
                      error={fieldState.error?.message}
                    />
                  )}
                />
              </CardContent>
            </Card>
          </GsapFade>

          <GsapFade delay={0.18}>
            <Card>
              <CardHeader>
                <CardTitle>Imagen de fondo (opcional)</CardTitle>
                <CardDescription>
                  URL pública de un fondo para el hero del portal.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-1.5">
                  <label
                    htmlFor="branding-bgImageUrl"
                    className="text-sm font-medium text-fg"
                  >
                    URL de la imagen
                  </label>
                  <Input
                    id="branding-bgImageUrl"
                    data-testid="branding-bgImageUrl"
                    {...form.register('bgImageUrl')}
                    invalid={!!form.formState.errors.bgImageUrl}
                    placeholder="https://cdn.tu-tenant.com/hero.webp"
                    autoComplete="off"
                  />
                  {form.formState.errors.bgImageUrl && (
                    <p
                      role="alert"
                      data-testid="branding-bgImageUrl-error"
                      className="text-sm font-medium text-danger"
                    >
                      {form.formState.errors.bgImageUrl.message}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          </GsapFade>

          <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="ghost"
              data-testid="branding-restore-btn"
              onClick={() => setConfirmRestore(true)}
              disabled={updateMutation.isPending}
            >
              Restaurar default
            </Button>
            <Button
              type="submit"
              data-testid="branding-save-btn"
              disabled={!canSave}
              aria-busy={updateMutation.isPending || undefined}
            >
              {updateMutation.isPending && (
                <LordIcon
                  name="arrow-loading"
                  trigger="loop"
                  size={20}
                />
              )}
              Guardar cambios
            </Button>
          </div>
        </div>

        {/* Preview column — sticky en desktop */}
        <div className="lg:col-span-7">
          <div className="lg:sticky lg:top-6">
            <PreviewPane
              displayName={watched.displayName ?? ''}
              tagline={watched.tagline ?? ''}
              primaryHex={
                isValidHex(watched.primaryHex)
                  ? watched.primaryHex
                  : DEFAULT_BRANDING.primaryHex
              }
              accentHex={
                isValidHex(watched.accentHex)
                  ? watched.accentHex
                  : DEFAULT_BRANDING.accentHex
              }
              logoUrl={logoPreview ?? data?.logoUrl ?? null}
              bgImageUrl={
                watched.bgImageUrl && watched.bgImageUrl.startsWith('http')
                  ? watched.bgImageUrl
                  : null
              }
            />
          </div>
        </div>
      </form>

      <Dialog open={confirmRestore} onOpenChange={setConfirmRestore}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restaurar branding por defecto</DialogTitle>
            <DialogDescription>
              Esto reemplazará los valores del formulario con los de la marca
              SegurAsist. Tendrás que pulsar &laquo;Guardar cambios&raquo; para
              aplicarlo en producción.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmRestore(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              data-testid="branding-restore-confirm"
              onClick={onRestoreDefault}
            >
              Restaurar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </GsapStagger>
  );
}
