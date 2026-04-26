import type { Meta, StoryObj } from '@storybook/react';
import { Pagination } from './pagination';

const meta: Meta<typeof Pagination> = {
  title: 'Primitives/Pagination',
  component: Pagination,
  tags: ['autodocs'],
  args: { hasPrev: true, hasNext: true, pageInfo: 'Página 2', onPrev: () => {}, onNext: () => {} },
};
export default meta;
type Story = StoryObj<typeof Pagination>;

export const Default: Story = {};
export const NoPrev: Story = { args: { hasPrev: false } };
export const NoNext: Story = { args: { hasNext: false } };
