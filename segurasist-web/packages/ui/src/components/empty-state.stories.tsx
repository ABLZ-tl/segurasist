import type { Meta, StoryObj } from '@storybook/react';
import { EmptyState } from './empty-state';
import { Button } from './button';

const meta: Meta<typeof EmptyState> = {
  title: 'Primitives/EmptyState',
  component: EmptyState,
  tags: ['autodocs'],
  args: {
    title: 'Sin lotes recientes',
    description: 'Cuando subas un archivo de carga masiva aparecerá aquí.',
  },
};
export default meta;
type Story = StoryObj<typeof EmptyState>;

export const Default: Story = {};
export const WithAction: Story = {
  args: { action: <Button>Cargar archivo</Button> },
};
