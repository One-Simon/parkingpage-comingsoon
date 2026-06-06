# SourceHive Coming Soon

<p align="center">
  <img alt="Node.js 22+" src="https://img.shields.io/badge/Node.js-22+-339933?style=for-the-badge&logo=node.js&logoColor=white">
  <img alt="Vite 8" src="https://img.shields.io/badge/Vite-8-646CFF?style=for-the-badge&logo=vite&logoColor=white">
  <img alt="TypeScript 6" src="https://img.shields.io/badge/TypeScript-6-3178C6?style=for-the-badge&logo=typescript&logoColor=white">
  <img alt="Pixi.js 8.18" src="https://img.shields.io/badge/Pixi.js-8.18-EA1E63?style=for-the-badge">
  <img alt="Matter.js 0.20" src="https://img.shields.io/badge/Matter.js-0.20-1B1F23?style=for-the-badge">
  <img alt="Render static site" src="https://img.shields.io/badge/Render-Static-46E3B7?style=for-the-badge&logo=render&logoColor=white">
  <img alt="Waitlist endpoint via VITE_FORM_ENDPOINT" src="https://img.shields.io/badge/Waitlist-VITE__FORM__ENDPOINT-0A7EA4?style=for-the-badge">
</p>

SourceHive Coming Soon is the deployable early-access page for SourceHive.

It shows the public landing panel, animated background, draggable `SOURCEHIVE` mosaic, and waitlist form used for launch updates.

## What It Is

- **Landing page** - SourceHive brand, positioning, and waitlist panel.
- **Static deployment** - Builds to plain files in `dist/`.
- **Waitlist ready** - Connects to a hosted form endpoint through `VITE_FORM_ENDPOINT`.
- **Accessible fallback** - Keeps readable DOM content and supports reduced-motion users.
- **Private app repo** - This repo contains SourceHive-specific copy, assets, and deployment settings.

> [!NOTE]
> This is the SourceHive production app repo. The public generic template lives separately at `One-Simon/parkingpage-comingsoon`.

## Quick Setup

### 1. Install Dependencies

Use Node.js 22+ and npm.

```bash
npm ci
```

### 2. Start Local Development

```bash
npm run dev
```

Open the local URL printed by Vite, usually:

```text
http://localhost:5173
```

### 3. Configure The Waitlist

Copy the example env file:

```bash
cp .env.example .env
```

Set your hosted form endpoint:

```env
VITE_FORM_ENDPOINT=https://formspree.io/f/your-id
```

> [!TIP]
> If `VITE_FORM_ENDPOINT` is empty, the page still runs, but the waitlist form is disabled. This is useful for local visual checks.

### 4. Build Before Deploying

```bash
npm run build
```

The production output is written to:

```text
dist/
```

## Deploy On Render

Create or update a Render static site from this private repository.

| Setting | Value |
|---|---|
| Repository | `SourceHiveAI/SourceHive-ComingSoon` |
| Branch | `main` |
| Runtime | Static |
| Build command | `npm ci && npm run build` |
| Publish directory | `dist` |

Required environment variables:

| Variable | Value |
|---|---|
| `NODE_VERSION` | `22` |
| `VITE_FORM_ENDPOINT` | SourceHive waitlist form endpoint |

> [!IMPORTANT]
> Deploy from `main`. Preview or sync branches can contain unfinished changes.

The included `render.yaml` mirrors these settings for Blueprint-based setup.

## Content And Branding

Most day-to-day changes are in these files:

| File | What To Change |
|---|---|
| `src/copy/researchMessaging.ts` | SourceHive panel copy, bullets, waitlist text |
| `src/render/blockLetters/rasterWordMask.ts` | Mosaic word shown in the animated background |
| `public/favicon.png` and `public/favicon.svg` | Browser icon and background glyph |
| `index.html` | Browser title and meta description |
| `src/style.css` | Layout, spacing, colors, and responsive panel styling |

> [!WARNING]
> Keep SourceHive copy and assets when accepting template updates. Placeholder content from the public template is not production content.

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

## Updating From The Template

Upstream template updates are handled by the automated sync workflow.

The workflow opens a pull request when the public template has new changes. Review that PR before merging.

> [!NOTE]
> Detailed sync instructions live in [UPSTREAM_SYNC.md](UPSTREAM_SYNC.md).

## Troubleshooting

### The Form Is Disabled

`VITE_FORM_ENDPOINT` is probably empty.

Set it locally in `.env` and in Render environment variables, then rebuild/redeploy.

### Changes To The Endpoint Do Not Show Up

Vite inlines `VITE_*` values at build time.

After changing `VITE_FORM_ENDPOINT`, run a new build or trigger a new Render deploy.

### Render Shows The Wrong Version

Check the Render service settings:

- Repository must be `SourceHiveAI/SourceHive-ComingSoon`.
- Branch must be `main`.
- Publish directory must be `dist`.

### The Animated Background Is Missing

Run a production build locally:

```bash
npm run build
npm run preview
```

If the static panel works but animation does not, check browser console errors and CSP settings.

> [!TIP]
> Reduced-motion settings intentionally disable the animated canvas and show a static fallback.
