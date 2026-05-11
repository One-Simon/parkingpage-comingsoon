import type { Plugin, UserConfig } from 'vite';

/**
 * Production Content-Security-Policy. Injected as a `<meta http-equiv>` tag at build time only,
 * so Vite's dev server (which needs `eval`/inline scripts and `ws://` for HMR) is not affected.
 *
 * `'unsafe-eval'` is required because Pixi v8's `RenderTargetSystem` / `UboSystem` build shader
 * accessor functions with `new Function(...)`. (Pixi ships an opt-in `pixi.js/unsafe-eval` shim
 * that monkey-patches the check, but the published 8.18.x package does not expose it as a subpath
 * import, so the only reliable fix is to allow eval at the document level.)
 *
 * `frame-ancestors` is intentionally omitted — browsers ignore it when delivered via `<meta>` and
 * log a warning. Set it as a real `Content-Security-Policy` header in Render's HTTP Headers panel
 * if you need clickjacking protection (X-Frame-Options DENY also works).
 *
 * To lock the form host, replace `https:` in `connect-src` with the explicit endpoint origin
 * (e.g. `https://formspree.io`).
 */
const PROD_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval' blob:",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https:",
  "base-uri 'self'",
  "form-action 'self'",
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
