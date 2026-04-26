import type { Meta, StoryObj } from '@storybook/react';
import { Badge } from './badge';

const meta: Meta<typeof Badge> = {
  title: 'Primitives/Badge',
  component: Badge,
  tags: ['autodocs'],
  args: { children: 'Vigente' },
};
export default meta;
type Story = StoryObj<typeof Badge>;

export const Default: Story = {};
export const Success: Story = { args: { variant: 'success', children: 'Vigente' } };
export const Warning: Story = { args: { variant: 'warning', children: 'Próxima a vencer' } };
export const Danger: Story = { args: { variant: 'danger', children: 'Vencida' } };
export const Outline: Story = { args: { variant: 'outline' } };
