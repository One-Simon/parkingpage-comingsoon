# parkingpage-comingsoon

<p align="center">
  <img alt="Node.js 24 LTS" src="https://img.shields.io/badge/Node.js-24%20LTS-339933?style=for-the-badge&logo=node.js&logoColor=white">
  <img alt="Vite 8" src="https://img.shields.io/badge/Vite-8-646CFF?style=for-the-badge&logo=vite&logoColor=white">
  <img alt="TypeScript 6" src="https://img.shields.io/badge/TypeScript-6-3178C6?style=for-the-badge&logo=typescript&logoColor=white">
  <img alt="Pixi.js 8.18" src="https://img.shields.io/badge/Pixi.js-8.18-EA1E63?style=for-the-badge">
  <img alt="Matter.js 0.20" src="https://img.shields.io/badge/Matter.js-0.20-1B1F23?style=for-the-badge">
  <img alt="Render static site" src="https://img.shields.io/badge/Render-Static-46E3B7?style=for-the-badge&logo=render&logoColor=white">
  <img alt="Waitlist endpoint via VITE_FORM_ENDPOINT" src="https://img.shields.io/badge/Waitlist-VITE__FORM__ENDPOINT-0A7EA4?style=for-the-badge">
</p>

`parkingpage-comingsoon` is a ready-to-customize coming soon page for product launches, waitlists, and early-access campaigns.

It ships with a glass-style content panel, animated WebGL background, draggable physics typography, and an optional waitlist form.

## What It Is

- **Coming soon page** - A complete first screen for a launch or waitlist.
- **Static deployment** - Builds to plain files in `dist/`.
- **Easy branding** - Change copy, colors, favicon, and the mosaic word in a few files.
- **Waitlist ready** - Connects to any hosted form endpoint through `VITE_FORM_ENDPOINT`.
- **Accessible fallback** - Keeps readable DOM content and supports reduced-motion users.

> [!NOTE]
> The included Your Brand content is demo content. Replace it with your own brand, copy, assets, and form endpoint before publishing.

## Quick Setup

### 1. Clone The Repo

```bash
git clone https://github.com/One-Simon/parkingpage-comingsoon.git
cd parkingpage-comingsoon
```

### 2. Install Dependencies

Use Node.js 24 LTS and npm.

```bash
npm ci
```

### 3. Start Local Development

```bash
npm run dev
```

Open the local URL printed by Vite, usually:

```text
http://localhost:5173
```

### 4. Configure The Waitlist

Copy the example env file:

```bash
cp .env.example .env
```

Set your hosted form endpoint:

```env
VITE_FORM_ENDPOINT=https://formspree.io/f/your-id
```

> [!TIP]
> If `VITE_FORM_ENDPOINT` is empty, the page still runs, but the waitlist form is disabled. This is useful while you are still working on the visual design.

### 5. Build Before Deploying

```bash
npm run build
```

The production output is written to:

```text
dist/
```

## Customize

Most day-to-day changes are in these files:

| File | What To Change |
|---|---|
| `src/copy/researchMessaging.ts` | Brand name, hero copy, highlight cards, waitlist text |
| `src/render/blockLetters/rasterWordMask.ts` | Mosaic word shown in the animated background |
| `public/favicon.png` and `public/favicon.svg` | Browser icon and background glyph |
| `index.html` | Browser title and meta description |
| `src/style.css` | Layout, spacing, colors, and responsive panel styling |

> [!IMPORTANT]
> `VITE_*` environment variables are inlined at build time. After changing `VITE_FORM_ENDPOINT`, build and deploy again.

## Deploy On Render

Create a Render static site or Blueprint from this repository.

| Setting | Value |
|---|---|
| Repository | `One-Simon/parkingpage-comingsoon` or your fork |
| Branch | `main` |
| Runtime | Static |
| Build command | `npm ci && npm run build` |
| Publish directory | `dist` |

Required environment variables:

| Variable | Value |
|---|---|
| `NODE_VERSION` | `24.16.0` |
| `VITE_FORM_ENDPOINT` | Your waitlist form endpoint, or leave empty to disable the form |

The included `render.yaml` mirrors these settings for Blueprint-based setup.

> [!TIP]
> You can deploy the built `dist/` folder anywhere that serves static files, including Netlify, Vercel, Cloudflare Pages, GitHub Pages, S3, or your own server.

## Useful Commands

| Command | What It Does |
|---|---|
| `npm run dev` | Starts the local Vite dev server |
| `npm run build` | Runs TypeScript and creates the production build |
| `npm run preview` | Serves the production build locally |
| `npm run lint` | Runs ESLint with zero warnings allowed |
| `npm run typecheck` | Runs TypeScript without emitting files |
| `npm run format` | Checks formatting in `src/` |
| `npm run format:fix` | Applies formatting in `src/` |

## Content Model

The default page is intentionally simple:

1. `src/copy/researchMessaging.ts` exports all visible panel copy.
2. `src/overlay.ts` renders the copy into the DOM.
3. `src/forms/waitlist.ts` binds the form to `VITE_FORM_ENDPOINT`.
4. `src/simulation.ts` starts the Pixi/Matter background.

> [!NOTE]
> The animated canvas is decorative. The main copy and waitlist form are plain DOM content.

## Troubleshooting

### The Form Is Disabled

`VITE_FORM_ENDPOINT` is probably empty.

Set it locally in `.env` and in your host's environment variables, then rebuild/redeploy.

### Changes To The Endpoint Do Not Show Up

Vite inlines `VITE_*` values at build time.

After changing `VITE_FORM_ENDPOINT`, run a new build or trigger a new deploy.

### The Animated Background Is Missing

Run a production build locally:

```bash
npm run build
npm run preview
```

If the static panel works but animation does not, check browser console errors and CSP settings.

> [!TIP]
> Reduced-motion settings intentionally disable the animated canvas and show a static fallback.

### The Page Uses The Wrong Brand

Search for the old brand name and update these files first:

```bash
rg "Your Brand|YourOldBrand"
```

The usual places are `src/copy/researchMessaging.ts`, `src/render/blockLetters/rasterWordMask.ts`, `index.html`, and the favicon assets.

## Contributing

Issues and pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR.

## License

MIT. See [LICENSE](LICENSE).
