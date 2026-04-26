'use client';

import * as React from 'react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Calendar as CalendarIcon } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import { DayPicker, type DayPickerSingleProps } from 'react-day-picker';
import { cn } from '../lib/cn';
import { Button } from './button';

export interface DatePickerProps {
  value?: Date;
  onChange: (date: Date | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}

export function DatePicker({
  value,
  onChange,
  placeholder = 'Selecciona una fecha',
  disabled,
  className,
  ariaLabel,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const dayPickerProps: DayPickerSingleProps = {
    mode: 'single',
    selected: value,
    onSelect: (date) => {
      onChange(date);
      setOpen(false);
    },
    locale: es,
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button
          variant="outline"
          aria-label={ariaLabel ?? placeholder}
          disabled={disabled}
          className={cn('w-full justify-start font-normal', !value && 'text-fg-muted', className)}
        >
          <CalendarIcon aria-hidden className="mr-2 h-4 w-4" />
          {value ? format(value, "d 'de' MMM yyyy", { locale: es }) : placeholder}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="z-50 rounded-md border border-border bg-bg p-3 text-fg shadow-md"
          align="start"
        >
          <DayPicker {...dayPickerProps} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
