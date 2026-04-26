import type { Meta, StoryObj } from '@storybook/react';
import { Toaster, toast } from './toast';
import { Button } from './button';

const meta: Meta = { title: 'Primitives/Toast', tags: ['autodocs'] };
export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => (
    <div className="space-y-3">
      <Toaster />
      <Button onClick={() => toast.success('Certificado emitido')}>Éxito</Button>
      <Button variant="destructive" onClick={() => toast.error('No se pudo emitir')}>
        Error
      </Button>
    </div>
  ),
};
