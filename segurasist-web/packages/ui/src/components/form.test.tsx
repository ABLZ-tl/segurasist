import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  useForm,
  type DefaultValues,
  type UseFormReturn,
  type FieldValues,
} from 'react-hook-form';
import {
  Form,
  FormControl,
  FormDescription,
  FormError,
  FormField,
  FormItem,
  FormLabel,
  useFormField,
} from './form';
import { Input } from './input';

interface HostProps<T extends FieldValues> {
  defaultValues?: DefaultValues<T>;
  onReady?: (methods: UseFormReturn<T>) => void;
  children: React.ReactNode;
}

function Host<T extends FieldValues>({ defaultValues, onReady, children }: HostProps<T>) {
  const methods = useForm<T>({
    defaultValues,
  });
  React.useEffect(() => {
    onReady?.(methods);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <Form {...methods}>{children}</Form>;
}

describe('<Form> integration', () => {
  it('FormLabel htmlFor matches FormControl id (label clicks focus the input)', async () => {
    const user = userEvent.setup();
    render(
      <Host<{ email: string }> defaultValues={{ email: '' }}>
        <FormField
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Correo</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
            </FormItem>
          )}
        />
      </Host>,
    );
    const label = screen.getByText('Correo');
    const input = screen.getByLabelText('Correo');
    expect(label).toHaveAttribute('for', input.id);
    await user.click(label);
    expect(input).toHaveFocus();
  });

  it('FormError renders error message from form state and uses role="alert"', async () => {
    let methods!: UseFormReturn<{ email: string }>;
    render(
      <Host<{ email: string }>
        defaultValues={{ email: '' }}
        onReady={(m) => {
          methods = m;
        }}
      >
        <FormField
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Correo</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormError />
            </FormItem>
          )}
        />
      </Host>,
    );
    await act(async () => {
      methods.setError('email', { type: 'manual', message: 'Requerido' });
    });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Requerido');
  });

  it('FormError returns null when no error and no children', () => {
    render(
      <Host<{ email: string }> defaultValues={{ email: '' }}>
        <FormField
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Correo</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormError />
            </FormItem>
          )}
        />
      </Host>,
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('FormControl wires aria-invalid and aria-describedby with description+message ids on error', async () => {
    let methods!: UseFormReturn<{ email: string }>;
    render(
      <Host<{ email: string }>
        defaultValues={{ email: '' }}
        onReady={(m) => {
          methods = m;
        }}
      >
        <FormField
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Correo</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormDescription>Tu correo electrónico</FormDescription>
              <FormError />
            </FormItem>
          )}
        />
      </Host>,
    );
    const input = screen.getByLabelText('Correo');
    expect(input).toHaveAttribute('aria-invalid', 'false');
    await act(async () => {
      methods.setError('email', { type: 'manual', message: 'Mal' });
    });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const describedBy = input.getAttribute('aria-describedby') ?? '';
    expect(describedBy.split(' ')).toHaveLength(2);
  });

  it('useFormField throws when used outside <FormField>', () => {
    function Naughty() {
      useFormField();
      return null;
    }
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      render(
        <Host<{ email: string }> defaultValues={{ email: '' }}>
          <Naughty />
        </Host>,
      ),
    ).toThrow(/useFormField must be used within <FormField>/);
    errSpy.mockRestore();
  });
});
