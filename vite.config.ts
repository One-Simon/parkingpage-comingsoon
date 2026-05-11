import type { Plugin, UserConfig } from 'vite';

/**
 * Production Content-Security-Policy. Injected as a `<meta http-equiv>` tag at build time only,
 * so Vite's dev server (which needs `eval`/inline scripts and `ws://` for HMR) is not affected.
 *
 * To lock the form host, replace `https:` in `connect-src` with the explicit endpoint origin
 * (e.g. `https://formspree.io`).
 */
const PROD_CSP = [
  "default-src 'self'",
  "script-src 'self' blob:",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https:",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ');

function cspPlugin(): Plugin {
  return {
    name: 'inject-csp',
    apply: 'build',
    transformIndexHtml(html) {
      const tag = `<meta http-equiv="Content-Security-Policy" content="${PROD_CSP}">`;
      return html.replace(/<head(\s[^>]*)?>/i, (m) => `${m}\n    ${tag}`);
    },
  };
}

export default {
  plugins: [cspPlugin()],
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
