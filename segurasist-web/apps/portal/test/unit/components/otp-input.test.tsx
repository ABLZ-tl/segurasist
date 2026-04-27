import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OtpInput } from '../../../components/auth/otp-input';

function ControlledOtp({
  onComplete,
  initialValue = '',
}: {
  onComplete?: (v: string) => void;
  initialValue?: string;
}): JSX.Element {
  const [value, setValue] = React.useState(initialValue);
  return <OtpInput value={value} onChange={setValue} onComplete={onComplete} />;
}

describe('<OtpInput />', () => {
  it('renders 6 cells by default', () => {
    render(<ControlledOtp />);
    const cells = screen.getAllByRole('textbox');
    expect(cells).toHaveLength(6);
  });

  it('auto-focuses the first cell on mount', () => {
    render(<ControlledOtp />);
    const first = screen.getByTestId('otp-cell-0');
    expect(first).toHaveFocus();
  });

  it('moves focus to the next cell when typing a digit', async () => {
    const user = userEvent.setup();
    render(<ControlledOtp />);
    const first = screen.getByTestId('otp-cell-0');
    first.focus();
    await user.keyboard('1');

    expect(screen.getByTestId('otp-cell-1')).toHaveFocus();
    expect((screen.getByTestId('otp-cell-0') as HTMLInputElement).value).toBe('1');
  });

  it('moves focus back when Backspace is pressed on an empty cell', async () => {
    const user = userEvent.setup();
    render(<ControlledOtp />);
    const cell0 = screen.getByTestId('otp-cell-0');
    const cell1 = screen.getByTestId('otp-cell-1');
    cell0.focus();
    await user.keyboard('1');
    expect(cell1).toHaveFocus();
    await user.keyboard('{Backspace}');

    expect(cell0).toHaveFocus();
    expect((cell0 as HTMLInputElement).value).toBe('');
  });

  it('fills all six cells when 6 digits are pasted', async () => {
    const user = userEvent.setup();
    render(<ControlledOtp />);
    const first = screen.getByTestId('otp-cell-0');
    first.focus();
    await user.paste('123456');

    expect((screen.getByTestId('otp-cell-0') as HTMLInputElement).value).toBe('1');
    expect((screen.getByTestId('otp-cell-1') as HTMLInputElement).value).toBe('2');
    expect((screen.getByTestId('otp-cell-2') as HTMLInputElement).value).toBe('3');
    expect((screen.getByTestId('otp-cell-3') as HTMLInputElement).value).toBe('4');
    expect((screen.getByTestId('otp-cell-4') as HTMLInputElement).value).toBe('5');
    expect((screen.getByTestId('otp-cell-5') as HTMLInputElement).value).toBe('6');
  });

  it('triggers onComplete exactly once when all 6 digits are entered', async () => {
    const onComplete = vi.fn();
    const user = userEvent.setup();
    render(<ControlledOtp onComplete={onComplete} />);

    const first = screen.getByTestId('otp-cell-0');
    first.focus();
    await user.keyboard('123456');

    await vi.waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
    expect(onComplete).toHaveBeenCalledWith('123456');
  });
});
