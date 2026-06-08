import { loadEnv } from 'vite';
import type { Plugin, UserConfig } from 'vite';
import { siteConfig } from './src/brand/siteConfig.ts';

/**
 * Production Content-Security-Policy. Injected as a `<meta http-equiv>` tag at build time only,
 * so Vite's dev server (which needs `eval`/inline scripts and `ws://` for HMR) is not affected.
 *
 * `'unsafe-eval'` is required because Pixi v8's `RenderTargetSystem` / `UboSystem` build shader
 * accessor functions with `new Function(...)`, so the document must allow eval for Pixi to boot.
 *
 * `frame-ancestors` is intentionally omitted - browsers ignore it when delivered via `<meta>` and
 * log a warning. Set it as a real `Content-Security-Policy` header in Render's HTTP Headers panel
 * if you need clickjacking protection (X-Frame-Options DENY also works).
 *
 * If `VITE_FORM_ENDPOINT` is a valid HTTPS URL, its origin is added to `connect-src`.
 */
function waitlistConnectSource(formEndpoint: string | undefined): string {
  if (!formEndpoint) return '';
  try {
    const url = new URL(formEndpoint);
    return url.protocol === 'https:' ? ` ${url.origin}` : '';
  } catch {
    return '';
  }
}

function cspPlugin(formEndpoint: string | undefined): Plugin {
  const prodCsp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-eval' blob:",
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${waitlistConnectSource(formEndpoint)}`,
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');

  return {
    name: 'inject-csp',
    apply: 'build',
    transformIndexHtml(html) {
      const tag = `<meta http-equiv="Content-Security-Policy" content="${prodCsp}">`;
      return html.replace(/<head(\s[^>]*)?>/i, (m) => `${m}\n    ${tag}`);
    },
  };
}

function escapeHtmlAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function brandHtmlPlugin(): Plugin {
  return {
    name: 'inject-brand-html',
    transformIndexHtml(html) {
      const faviconTags = [
        `<link rel="icon" type="image/svg+xml" href="${escapeHtmlAttribute(siteConfig.assets.faviconSvg)}">`,
        `<link rel="alternate icon" type="image/png" href="${escapeHtmlAttribute(siteConfig.assets.faviconPng)}">`,
      ].join('\n    ');

      return html
        .replace(
          /<title>[\s\S]*?<\/title>/i,
          `<title>${escapeHtmlAttribute(siteConfig.pageTitle)}</title>`,
        )
        .replace(
          /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/i,
          `<meta name="description" content="${escapeHtmlAttribute(siteConfig.metaDescription)}">`,
        )
        .replace(/<head(\s[^>]*)?>/i, (match) => `${match}\n    ${faviconTags}`);
    },
  };
}

export default ({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    plugins: [brandHtmlPlugin(), cspPlugin(env.VITE_FORM_ENDPOINT)],
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
};
