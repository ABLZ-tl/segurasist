import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Switch } from './switch';

describe('<Switch>', () => {
  it('renders with role=switch and starts unchecked by default', () => {
    render(<Switch aria-label="enable" />);
    const sw = screen.getByRole('switch', { name: 'enable' });
    expect(sw).toBeTruthy();
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(sw.getAttribute('data-state')).toBe('unchecked');
  });

  it('toggles aria-checked + data-state on click', async () => {
    const user = userEvent.setup();
    render(<Switch aria-label="kb-enabled" />);
    const sw = screen.getByRole('switch', { name: 'kb-enabled' });
    await user.click(sw);
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(sw.getAttribute('data-state')).toBe('checked');
    await user.click(sw);
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(sw.getAttribute('data-state')).toBe('unchecked');
  });

  it('invokes onCheckedChange with the new value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Switch aria-label="x" onCheckedChange={onChange} />);
    await user.click(screen.getByRole('switch', { name: 'x' }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('respects controlled `checked` prop', () => {
    function Controlled() {
      const [checked, setChecked] = React.useState(true);
      return <Switch aria-label="y" checked={checked} onCheckedChange={setChecked} />;
    }
    render(<Controlled />);
    expect(screen.getByRole('switch', { name: 'y' }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('honours disabled and does not toggle', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Switch aria-label="z" disabled onCheckedChange={onChange} />);
    const sw = screen.getByRole('switch', { name: 'z' });
    await user.click(sw);
    expect(onChange).not.toHaveBeenCalled();
    expect(sw.getAttribute('aria-checked')).toBe('false');
  });
});
