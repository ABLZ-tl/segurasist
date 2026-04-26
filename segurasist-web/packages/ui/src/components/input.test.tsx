import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Input } from './input';

describe('<Input>', () => {
  it.each(['text', 'email', 'password', 'number', 'tel'])(
    'renders type=%s',
    (type) => {
      render(<Input type={type} aria-label="x" />);
      expect(screen.getByLabelText('x')).toHaveAttribute('type', type);
    },
  );

  it('defaults to type=text when not provided', () => {
    render(<Input aria-label="x" />);
    expect(screen.getByLabelText('x')).toHaveAttribute('type', 'text');
  });

  it('applies the mobile 48px / desktop 40px touch-target classes', () => {
    render(<Input aria-label="x" />);
    const input = screen.getByLabelText('x');
    expect(input).toHaveClass('h-12');
    expect(input).toHaveClass('lg:h-10');
  });

  it('sets aria-invalid="true" when invalid prop is true', () => {
    render(<Input aria-label="x" invalid />);
    expect(screen.getByLabelText('x')).toHaveAttribute('aria-invalid', 'true');
  });

  it('omits aria-invalid attribute when invalid is false/undefined', () => {
    render(<Input aria-label="x" />);
    expect(screen.getByLabelText('x')).not.toHaveAttribute('aria-invalid');
  });

  it('applies danger border classes when invalid', () => {
    render(<Input aria-label="x" invalid />);
    expect(screen.getByLabelText('x')).toHaveClass('border-danger');
  });

  it('respects disabled and prevents typing', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Input aria-label="x" disabled onChange={onChange} />);
    const input = screen.getByLabelText('x');
    expect(input).toBeDisabled();
    await user.type(input, 'hello');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('fires onChange for each typed character (controlled)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Input aria-label="x" value="" onChange={onChange} />);
    await user.type(screen.getByLabelText('x'), 'abc');
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('forwards ref to the underlying input', () => {
    const ref = { current: null as HTMLInputElement | null };
    render(<Input aria-label="x" ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });

  it('merges custom className with defaults', () => {
    render(<Input aria-label="x" className="custom-input" />);
    expect(screen.getByLabelText('x')).toHaveClass('custom-input');
  });
});
