'use client';

/**
 * Sprint 5 — MT-2 iter 1.
 *
 * <LogoDropzone /> — dropzone accesible para subir el logo del tenant.
 *
 * Validaciones cliente-side (defensa en profundidad — el backend re-valida
 * con file-magic-bytes según el guideline MT-1):
 *   - Tipos: png, svg, webp.
 *   - Tamaño máx: 512KB.
 *   - Dimensión máx: 1024x1024 (cargamos `Image()` para validarlo).
 *
 * Accesibilidad:
 *   - role="button", aria-label, tabIndex=0.
 *   - Enter/Space dispara el click del input file.
 *   - El input file está `sr-only` (no `display:none`, que algunos lectores
 *     ignoran).
 *
 * UX premium:
 *   - Lordicon "cloud-upload" anima en hover (consumido desde @segurasist/ui).
 *   - drag-active estado con borde accent + tinte sutil.
 *   - Errores inline (no toast global) bajo el dropzone.
 *   - Preview thumbnail con botón "Eliminar" superpuesto.
 *
 * Cuando el usuario selecciona un archivo válido se invoca onUpload(file);
 * el padre (BrandingEditor) envuelve esto con la mutación react-query y
 * mostrará el toast de éxito al resolver.
 */

import * as React from 'react';
import { Button, LordIcon } from '@segurasist/ui';
import { cn } from '@segurasist/ui';

export const LOGO_MAX_BYTES = 512 * 1024; // 512KB
export const LOGO_MAX_DIM = 1024; // px
const ACCEPT_MIME = ['image/png', 'image/svg+xml', 'image/webp'] as const;
const ACCEPT_ATTR = ACCEPT_MIME.join(',');

export interface LogoDropzoneProps {
  /** URL actual del logo (para preview cuando ya hay uno guardado). */
  currentUrl: string | null;
  /** Pendiente de subir — preview optimista local, no llega aún al servidor. */
  previewUrl?: string | null;
  onUpload: (file: File) => void;
  onDelete: () => void;
  isUploading?: boolean;
  isDeleting?: boolean;
  /** Mensaje de error remoto (después de fallar la mutación). */
  remoteError?: string | null;
  disabled?: boolean;
}

interface LocalError {
  code: 'type' | 'size' | 'dim' | 'read';
  message: string;
}

async function readImageDimensions(
  file: File,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    // SVG no expone naturalWidth confiable cross-browser; lo aprobamos por
    // tipo (el backend valida bounds).
    if (file.type === 'image/svg+xml') {
      resolve({ width: 0, height: 0 });
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo leer la imagen'));
    };
    img.src = url;
  });
}

async function validateFile(file: File): Promise<LocalError | null> {
  if (!ACCEPT_MIME.includes(file.type as (typeof ACCEPT_MIME)[number])) {
    return {
      code: 'type',
      message: 'Formato no soportado. Usa PNG, SVG o WebP.',
    };
  }
  if (file.size > LOGO_MAX_BYTES) {
    return {
      code: 'size',
      message: `Tamaño máximo 512KB. El archivo pesa ${Math.round(
        file.size / 1024,
      )}KB.`,
    };
  }
  try {
    const { width, height } = await readImageDimensions(file);
    if (
      file.type !== 'image/svg+xml' &&
      (width > LOGO_MAX_DIM || height > LOGO_MAX_DIM)
    ) {
      return {
        code: 'dim',
        message: `Dimensiones máximas ${LOGO_MAX_DIM}x${LOGO_MAX_DIM}. El archivo es ${width}x${height}.`,
      };
    }
  } catch {
    return { code: 'read', message: 'No se pudo procesar la imagen.' };
  }
  return null;
}

export function LogoDropzone({
  currentUrl,
  previewUrl,
  onUpload,
  onDelete,
  isUploading,
  isDeleting,
  remoteError,
  disabled,
}: LogoDropzoneProps): JSX.Element {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = React.useState(false);
  const [localError, setLocalError] = React.useState<LocalError | null>(null);

  const showImage = previewUrl ?? currentUrl;

  const handleFile = React.useCallback(
    async (file: File) => {
      setLocalError(null);
      const err = await validateFile(file);
      if (err) {
        setLocalError(err);
        return;
      }
      onUpload(file);
    },
    [onUpload],
  );

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    if (disabled) return;
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    // Reset para permitir re-subir el mismo nombre.
    e.target.value = '';
  };

  const error = localError?.message ?? remoteError ?? null;
  const busy = !!isUploading || !!isDeleting;

  return (
    <div className="space-y-2">
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled || undefined}
        aria-label="Subir logotipo del tenant"
        aria-busy={busy || undefined}
        data-testid="logo-dropzone"
        data-drag-active={dragActive ? 'true' : 'false'}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={onDrop}
        className={cn(
          'group relative flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-surface px-6 py-8 text-center transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          dragActive && 'border-accent bg-accent/5 ring-2 ring-accent/20',
          !disabled && !showImage && 'hover:border-accent/60 hover:bg-accent/[0.03]',
          disabled && 'cursor-not-allowed opacity-50',
          !disabled && 'cursor-pointer',
        )}
      >
        {showImage ? (
          <div className="flex w-full items-center gap-4">
            {/* Preview thumbnail */}
            <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-lg border border-border bg-bg">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={showImage}
                alt="Logo actual"
                className="h-full w-full object-contain"
              />
            </div>
            <div className="min-w-0 flex-1 text-left">
              <p className="text-sm font-medium text-fg">Logo actual</p>
              <p className="mt-0.5 text-xs text-fg-muted">
                Click o arrastra otro archivo para reemplazarlo.
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="logo-dropzone-delete"
              loading={isDeleting}
              disabled={disabled || busy}
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              aria-label="Eliminar logotipo"
            >
              <LordIcon
                name="trash-bin"
                trigger="hover"
                size={16}
                className="mr-1.5 inline-block"
              />
              Eliminar
            </Button>
          </div>
        ) : (
          <>
            <LordIcon
              name="cloud-upload"
              trigger="hover"
              size={42}
              className="text-fg-muted group-hover:text-accent"
            />
            <div className="space-y-1">
              <p className="text-sm font-medium text-fg">
                Arrastra y suelta el logotipo aquí
              </p>
              <p className="text-xs text-fg-muted">
                o haz click para seleccionar — PNG, SVG o WebP, máx. 512KB · 1024×1024
              </p>
            </div>
          </>
        )}
        <input
          ref={inputRef}
          data-testid="logo-dropzone-input"
          type="file"
          accept={ACCEPT_ATTR}
          className="sr-only"
          disabled={disabled}
          onChange={onChange}
        />
      </div>
      {error && (
        <p
          role="alert"
          data-testid="logo-dropzone-error"
          className="text-sm font-medium text-danger"
        >
          {error}
        </p>
      )}
    </div>
  );
}
