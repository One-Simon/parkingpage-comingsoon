# ParkingPage-ComingSoon

Standalone Render **Static Site** with a fullscreen Pixi layer (interactive dot field + Matter.js draggable letter blocks), `prefers-reduced-motion` fallback, and a waitlist wired to **[Formspree](https://formspree.io/)** or **[Getform](https://getform.io/)** via **`VITE_FORM_ENDPOINT`**.

## Prerequisites

Node.js **22+** (recommended).

## Local development

From the project root:

```powershell
cd C:\Users\Simon\parkingpage-comingsoon
copy .env.example .env   # optional: set VITE_FORM_ENDPOINT for real form posts
npm ci
npm run dev
```

- Vite serves on **`http://localhost:5173`** by default.
- The dev server also binds to **all network interfaces** (`host: true` in `vite.config.ts`), so you can open it from another device on your LAN using your machine’s IP (for example `http://192.168.x.x:5173`).
- Hot reload applies when you edit `src/**` files.

To exercise a **production build** locally:

```powershell
npm run build
npm run preview
```

(`preview` uses port **4173** by default, also with `host: true`.)

## Deploying on Render.com (Static Site)

| Dashboard field       | Value                        |
|----------------------|------------------------------|
| Build Command        | `npm ci && npm run build`    |
| Publish Directory    | `dist`                       |
| Environment variable | `VITE_FORM_ENDPOINT` → full HTTPS form URL |

Changing `VITE_*` vars requires a rebuild so values are inlined via `import.meta.env`.

## Waitlist backends

Either provider works with the built-in fetch submitter:

1. **Formspree** → create form → copy `POST` URL ending in `/f/<id>`.
2. **Getform** → create endpoint URL `https://getform.io/f/<slug>`.

If `VITE_FORM_ENDPOINT` is missing, the form stays disabled and shows neutral visitor copy (deployment wiring belongs in this README, not on the page).

## Reduced motion behaviour

Clients advertising `prefers-reduced-motion: reduce` tear down Pixi+Matter listeners and expose a muted static gradient backdrop; copy + keyboard remain reachable.

## GitHub remote

```powershell
git remote add origin https://github.com/<you>/parkingpage-comingsoon.git
git push -u origin main
```

