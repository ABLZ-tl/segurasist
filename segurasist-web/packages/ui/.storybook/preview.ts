import type { Preview } from '@storybook/react';
import '../src/globals.css';

const preview: Preview = {
  parameters: {
    actions: { argTypesRegex: '^on[A-Z].*' },
    controls: {
      matchers: { color: /(background|color)$/i, date: /Date$/ },
    },
    backgrounds: {
      default: 'app',
      values: [
        { name: 'app', value: '#FFFFFF' },
        { name: 'surface', value: '#F5F7FA' },
      ],
    },
    a11y: { config: {} },
  },
};

export default preview;
