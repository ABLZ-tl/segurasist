import * as React from 'react';
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './select';

beforeAll(() => {
  // Radix Select internally uses these APIs; jsdom does not implement them.
  if (typeof Element !== 'undefined') {
    if (!Element.prototype.hasPointerCapture) {
      Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
    }
    if (!Element.prototype.releasePointerCapture) {
      Element.prototype.releasePointerCapture = vi.fn();
    }
    if (!Element.prototype.scrollIntoView) {
      Element.prototype.scrollIntoView = vi.fn();
    }
  }
});

function Harness({
  value,
  onValueChange,
  defaultValue,
}: {
  value?: string;
  defaultValue?: string;
  onValueChange?: (v: string) => void;
}) {
  return (
    <Select value={value} defaultValue={defaultValue} onValueChange={onValueChange}>
      <SelectTrigger aria-label="fruta">
        <SelectValue placeholder="Elegir" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="apple">Manzana</SelectItem>
        <SelectItem value="banana">Plátano</SelectItem>
        <SelectItem value="cherry">Cereza</SelectItem>
      </SelectContent>
    </Select>
  );
}

describe('<Select>', () => {
  it('renders trigger with placeholder when no value', () => {
    render(<Harness />);
    const trigger = screen.getByRole('combobox', { name: 'fruta' });
    expect(trigger.textContent).toContain('Elegir');
  });

  it('shows the selected value text when defaultValue is provided', () => {
    render(<Harness defaultValue="banana" />);
    const trigger = screen.getByRole('combobox', { name: 'fruta' });
    expect(trigger.textContent).toContain('Plátano');
  });

  it('opens the listbox when trigger is clicked and renders items', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('combobox', { name: 'fruta' }));
    const items = await screen.findAllByRole('option');
    expect(items.map((o) => o.textContent)).toEqual([
      'Manzana',
      'Plátano',
      'Cereza',
    ]);
  });

  it('invokes onValueChange when an item is selected', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onValueChange={onChange} />);
    await user.click(screen.getByRole('combobox', { name: 'fruta' }));
    await user.click(await screen.findByRole('option', { name: 'Cereza' }));
    expect(onChange).toHaveBeenCalledWith('cherry');
  });

  it('respects controlled value prop', () => {
    function Controlled() {
      const [value, setValue] = React.useState('apple');
      return (
        <>
          <Harness value={value} onValueChange={setValue} />
          <button type="button" onClick={() => setValue('cherry')}>
            set-cherry
          </button>
        </>
      );
    }
    render(<Controlled />);
    const trigger = screen.getByRole('combobox', { name: 'fruta' });
    expect(trigger.textContent).toContain('Manzana');
  });
});
