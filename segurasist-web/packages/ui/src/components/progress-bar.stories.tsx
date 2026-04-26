import type { Meta, StoryObj } from '@storybook/react';
import { ProgressBar } from './progress-bar';

const meta: Meta<typeof ProgressBar> = {
  title: 'Primitives/ProgressBar',
  component: ProgressBar,
  tags: ['autodocs'],
  args: { value: 60, label: 'Consumo de cobertura' },
};
export default meta;
type Story = StoryObj<typeof ProgressBar>;

export const Default: Story = {};
export const Success: Story = { args: { tone: 'success', value: 30 } };
export const Warning: Story = { args: { tone: 'warning', value: 75 } };
export const Danger: Story = { args: { tone: 'danger', value: 95 } };
