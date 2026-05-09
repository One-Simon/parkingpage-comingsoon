# ParkingPage-ComingSoon

Standalone Render **Static Site** with a fullscreen Pixi layer (interactive dot field + Matter.js draggable boxes), `prefers-reduced-motion` fallback, and a waitlist wired to **[Formspree](https://formspree.io/)** or **[Getform](https://getform.io/)** via **`VITE_FORM_ENDPOINT`**.

## Prerequisites

Node.js **22+** (project engines target modern LTS; `package.json` can add `engines` if you want CI enforcement locally).

## Local development

```bash
cp .env.example .env          # optionally set VITE_FORM_ENDPOINT during development
npm ci
npm run dev
```

## Production build smoke test

```bash
npm ci
npm run build
npm run preview
```

## Deploying on Render.com (Static Site)

| Dashboard field       | Value                        |
|----------------------|------------------------------|
| Build Command        | `npm ci && npm run build`    |
| Publish Directory    | `dist`                       |
| Environment variable | `VITE_FORM_ENDPOINT` → full HTTPS form URL |

Changing `VITE_*` vars requires triggering a rebuild so values are recomputed via `import.meta.env`.

## Waitlist backends

Either provider works with the built-in AJAX submitter:

1. **Formspree** → create form → copy `POST` URL ending in `/f/<id>`.
2. **Getform** → create endpoint URL `https://getform.io/f/<slug>`.

If `VITE_FORM_ENDPOINT` is blank the UI disables submissions and surfaces helper copy referencing ops/setup.

## Reduced motion behaviour

Clients advertising `prefers-reduced-motion: reduce` tear down Pixi+Matter listeners and expose a muted static gradient backdrop; copy + keyboard remain reachable.

## Pushing your own GitHub remote

Initialize or attach the slug you chose earlier:

```bash
git remote add origin https://github.com/<you>/parkingpage-comingsoon.git
git push -u origin main
```

(Case-insensitive on GitHub, but **`parkingpage-comingsoon`** is the chosen canonical slug.)

## Copy scope

Messaging focuses strictly on research discovery / clustering / transparency—no scripted production lane language on this landing.
