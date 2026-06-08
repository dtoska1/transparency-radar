import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';
import { ADMIN_ALLOWED_DOMAIN } from './config/admin-origin.mjs';

export default defineConfig({
  output: 'server',
  adapter: node({
    mode: 'standalone',
  }),
  security: {
    allowedDomains: [ADMIN_ALLOWED_DOMAIN],
    // @astrojs/node standalone does not reconstruct protocol from X-Forwarded-Proto.
    // Mutating BFF routes enforce the equivalent exact-origin check themselves.
    checkOrigin: false,
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
