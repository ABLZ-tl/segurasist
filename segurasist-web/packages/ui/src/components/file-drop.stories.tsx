import type { Meta, StoryObj } from '@storybook/react';
import { FileDrop } from './file-drop';

const meta: Meta<typeof FileDrop> = {
  title: 'Primitives/FileDrop',
  component: FileDrop,
  tags: ['autodocs'],
  args: {
    title: 'Arrastra y suelta el archivo CSV',
    hint: 'Tamaño máximo 25 MB',
    onFiles: () => {},
  },
};
export default meta;
type Story = StoryObj<typeof FileDrop>;

export const Default: Story = {};
export const Disabled: Story = { args: { disabled: true } };
