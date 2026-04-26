'use client';

import * as React from 'react';
import { UploadCloud } from 'lucide-react';
import { cn } from '../lib/cn';

export interface FileDropProps {
  accept?: string;
  multiple?: boolean;
  maxSizeBytes?: number;
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  className?: string;
  title?: string;
  hint?: string;
}

export function FileDrop({
  accept,
  multiple,
  maxSizeBytes,
  onFiles,
  disabled,
  className,
  title = 'Arrastra y suelta el archivo aquí',
  hint,
}: FileDropProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = React.useState(false);

  const handleFiles = React.useCallback(
    (fileList: FileList | null) => {
      if (!fileList || disabled) return;
      const files = Array.from(fileList);
      const valid = maxSizeBytes
        ? files.filter((f) => f.size <= maxSizeBytes)
        : files;
      onFiles(valid);
    },
    [maxSizeBytes, onFiles, disabled],
  );

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || undefined}
      aria-label={title}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragActive(false);
        handleFiles(e.dataTransfer.files);
      }}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-surface px-6 py-10 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        dragActive && 'border-accent bg-accent/5',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
    >
      <UploadCloud aria-hidden className="mb-3 h-10 w-10 text-fg-muted" />
      <p className="text-sm font-medium text-fg">{title}</p>
      {hint && <p className="mt-1 text-xs text-fg-muted">{hint}</p>}
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        {...(accept ? { accept } : {})}
        multiple={multiple}
        disabled={disabled}
        onChange={(e) => handleFiles(e.target.files)}
      />
    </div>
  );
}
