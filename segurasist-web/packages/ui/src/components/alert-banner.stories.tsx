import type { Meta, StoryObj } from '@storybook/react';
import { AlertBanner } from './alert-banner';

const meta: Meta<typeof AlertBanner> = {
  title: 'Primitives/AlertBanner',
  component: AlertBanner,
  tags: ['autodocs'],
  args: { title: 'Información', children: 'Sus datos se actualizarán en breve.' },
};
export default meta;
type Story = StoryObj<typeof AlertBanner>;

export const Info: Story = {};
export const Success: Story = { args: { tone: 'success', title: 'Listo' } };
export const Warning: Story = { args: { tone: 'warning', title: 'Atención' } };
export const Danger: Story = { args: { tone: 'danger', title: 'Error' } };
