import type { Config } from 'tailwindcss';
import preset from '@segurasist/config/tailwind';

const config: Config = {
  presets: [preset],
  content: ['./src/**/*.{ts,tsx}', './.storybook/**/*.{ts,tsx,mdx}'],
};

export default config;
