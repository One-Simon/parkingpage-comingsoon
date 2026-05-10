import type { UserConfig } from 'vite';

export default {
  plugins: [],
  server: {
    host: true,
    port: 5173,
    strictPort: false,
  },
  preview: {
    host: true,
    port: 4173,
    strictPort: false,
  },
} satisfies UserConfig;
