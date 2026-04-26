import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Modal,
} from './dialog';

function Harness({ defaultOpen = false }: { defaultOpen?: boolean }) {
  return (
    <Dialog defaultOpen={defaultOpen}>
      <DialogTrigger>Abrir</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirmación</DialogTitle>
          <DialogDescription>¿Estás seguro?</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <button type="button">Aceptar</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

describe('<Dialog>', () => {
  it('does not render content when closed', () => {
    render(<Harness />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens via trigger click and shows the title and description', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('Confirmación')).toBeTruthy();
    expect(screen.getByText('¿Estás seguro?')).toBeTruthy();
  });

  it('renders a close button labelled "Cerrar" inside the content', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    expect(screen.getByRole('button', { name: 'Cerrar' })).toBeTruthy();
  });

  it('closes when ESC is pressed', async () => {
    const user = userEvent.setup();
    render(<Harness defaultOpen />);
    expect(screen.getByRole('dialog')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes when the explicit Close button is clicked', async () => {
    const user = userEvent.setup();
    render(<Harness defaultOpen />);
    await user.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('exposes Modal as an alias of Dialog', () => {
    expect(Modal).toBe(Dialog);
  });

  it('moves focus into the dialog when opened', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});
