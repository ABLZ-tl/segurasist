import type { Meta, StoryObj } from '@storybook/react';
import { Stat } from './stat';

const meta: Meta<typeof Stat> = {
  title: 'Primitives/Stat',
  component: Stat,
  tags: ['autodocs'],
  args: { label: 'Asegurados activos', value: '12,480', trend: 4.2 },
};
export default meta;
type Story = StoryObj<typeof Stat>;

export const Default: Story = {};
export const Loading: Story = { args: { loading: true, value: '' } };
export const NoTrend: Story = { args: { trend: undefined } };
