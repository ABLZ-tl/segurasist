import type { Meta, StoryObj } from '@storybook/react';
import { ChatWidget } from './chat-widget';

const meta: Meta<typeof ChatWidget> = {
  title: 'Primitives/ChatWidget',
  component: ChatWidget,
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj<typeof ChatWidget>;

export const Default: Story = {
  render: () => (
    <div className="relative h-96 w-96 border border-border bg-surface">
      <ChatWidget />
    </div>
  ),
};

export const WithMessages: Story = {
  render: () => (
    <div className="relative h-96 w-96 border border-border bg-surface">
      <ChatWidget
        messages={[
          { id: '1', author: 'user', text: '¿Hasta cuándo es mi póliza?' },
          { id: '2', author: 'bot', text: 'Tu póliza está vigente hasta el 31 de marzo de 2027.' },
        ]}
      />
    </div>
  ),
};
