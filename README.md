<div align="center">

# parkingpage-comingsoon

**A drop-in coming soon page template** with an interactive WebGL background, draggable physics typography, an email waitlist, and a static-site deployment setup.

[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Pixi.js](https://img.shields.io/badge/Pixi.js-8-EA1E63?logo=javascript&logoColor=white)](https://pixijs.com/)
[![Matter.js](https://img.shields.io/badge/Matter.js-0.20-1B1F23)](https://brm.io/matter-js/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Deploy on Render](https://img.shields.io/badge/deploy-Render-46E3B7?logo=render&logoColor=white)](#deploy-to-render)

</div>

---

## Quick Start

Requirements: **Node.js 22+** and npm.

```bash
git clone https://github.com/One-Simon/parkingpage-comingsoon.git
cd parkingpage-comingsoon
cp .env.example .env          # optional - set VITE_FORM_ENDPOINT here
npm ci
npm run dev                   # http://localhost:5173
```

Production bundle locally:

```bash
npm run build
npm run preview               # http://localhost:4173
```

This is a deployable app/template, not an npm package, so `package.json` intentionally keeps `"private": true`. `package-lock.json` is committed so `npm ci` installs reproducible dependency versions in CI and static hosts.

---

## Customize

Most branding lives in a few files:

| File | Purpose |
|---|---|
| `src/copy/researchMessaging.ts` | Brand name, hero copy, highlight cards, waitlist copy |
| `src/render/blockLetters/rasterWordMask.ts` | Default mosaic word (`MOSAIC_WORD`) |
| `public/favicon.png` / `public/favicon.svg` | Browser favicon and dot-field glyph |
| `src/style.css` | CSS variables, typography, layout, responsive behavior |
| `src/render/createApp.ts` | Pixi background color and resolution cap |
| `.env` | Optional `VITE_FORM_ENDPOINT` waitlist endpoint |

The included default uses fictional Acme demo content. Replace it with your own product copy, favicon, colors, and mosaic word.

For a different shape such as a logo or custom tile layout, wire a custom `TileLayoutProvider` into `BoxesLayer`. `src/render/mosaic/providers/CustomShapeProvider.ts` is included as a starting point.

---

## Waitlist Endpoint

Set a hosted form URL locally in `.env` and in your host's environment variables:

```env
VITE_FORM_ENDPOINT=https://formspree.io/f/abcdEFGH
```

| Provider | URL shape |
|---|---|
| Formspree | `https://formspree.io/f/<your-form-id>` |
| Getform | `https://getform.io/f/<your-endpoint>` |

The submitter in `src/forms/waitlist.ts` sends `multipart/form-data` and expects a JSON response. If `VITE_FORM_ENDPOINT` is empty, the form renders disabled with neutral helper copy. `VITE_*` values are inlined at build time, so changing the endpoint requires a rebuild/redeploy.

---

## Deploy

### Deploy To Render

`render.yaml` is included:

```yaml
services:
  - type: web
    name: parkingpage-comingsoon
    runtime: static
    buildCommand: npm ci && npm run build
    staticPublishPath: ./dist
    envVars:
      - key: NODE_VERSION
        value: "22"
      - key: VITE_FORM_ENDPOINT
        sync: false
```

In Render, create a Blueprint from this repo and set `VITE_FORM_ENDPOINT` if you want the waitlist enabled.

### Deploy Anywhere Else

Output is plain static files in `dist/`.

| Host | Build command | Publish dir |
|---|---|---|
| Netlify | `npm ci && npm run build` | `dist` |
| Vercel | framework: Other | `dist` |
| Cloudflare Pages | `npm ci && npm run build` | `dist` |
| GitHub Pages | `npm ci && npm run build` | `dist` |
| S3 + CloudFront | `npm run build`, then sync `dist/` | n/a |

For non-root deploys, set Vite's `base` in `vite.config.ts`; the favicon loader uses Vite's base path automatically.

---

## Security Headers / CSP

A production-only Content Security Policy is injected by the Vite plugin in `vite.config.ts`.

Default policy summary:

```text
default-src 'self';
script-src  'self' 'unsafe-eval' blob:;
worker-src  'self' blob:;
style-src   'self' 'unsafe-inline';
img-src     'self' data: blob:;
font-src    'self' data:;
connect-src 'self' https:;
base-uri    'self';
form-action 'self';
object-src  'none';
```

`'unsafe-eval'` is required by Pixi v8 shader internals in this build. `frame-ancestors` is intentionally omitted because browsers ignore it from meta CSP; set it as a real HTTP header at your host if you need clickjacking protection.

The default `connect-src 'self' https:` keeps form providers plug-and-play. To restrict submissions to one provider, replace `https:` with the explicit endpoint origin, for example `https://formspree.io`.

---

## Using A Private Branded App

The recommended split is:

1. Keep this repository as the generic OSS upstream.
2. Create a private branded app repo or private fork.
3. Replace copy, assets, environment variables, and deployment config in the private app.
4. Periodically merge or rebase upstream changes from this repo into the private app.

For SourceHive, the preserved private app fork is `SourceHiveAI/SourceHive-ComingSoon`, with this repo as the generic upstream.

---

## Scripts

| Command | What |
|---|---|
| `npm run dev` | Start Vite dev server |
| `npm run build` | TypeScript check + production build |
| `npm run preview` | Serve the production bundle locally |
| `npm run typecheck` | Run `tsc --noEmit` |
| `npm run lint` | Run ESLint with zero warnings |
| `npm run format` | Check Prettier formatting for `src` |
| `npm run format:fix` | Write Prettier formatting for `src` |

---

## Accessibility

- DOM copy renders before the canvas and stays keyboard/screen-reader friendly.
- The Pixi canvas and scrim layers are `aria-hidden`.
- The waitlist has an `aria-live="polite"` status region.
- `prefers-reduced-motion: reduce` disables the animated canvas and shows a static fallback.

---

## Contributing

Issues and pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) first.

## License

MIT. See [LICENSE](LICENSE).
