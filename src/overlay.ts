import { siteConfig, type HighlightCardIcon } from './brand/siteConfig.ts';

/** Insert marketing card DOM into `#ui-root` */
export function mountOverlay(root: HTMLElement) {
  root.className = 'ui-stack';

  root.innerHTML = `
    <div class="scrim scrim-behind-cards" aria-hidden="true"></div>
    <section class="glass-card" aria-labelledby="hero-heading">
      <div class="panel-section intro-panel">
        <div class="glass-card-head">
          <h1 id="hero-heading" class="brand-title">${escapeHtml(siteConfig.brandName)}</h1>
          <img
            class="glass-card-logo"
            src="${escapeHtml(siteConfig.assets.cardLogo)}"
            width="94"
            height="94"
            alt=""
            decoding="async"
            aria-hidden="true"
          />
        </div>
        <p class="tagline">${escapeHtml(siteConfig.copy.tagline)}</p>
        <p class="lede">${formatLedeHtml(siteConfig.copy.lede)}</p>
      </div>
      <div class="panel-section highlights-panel">
        <div class="highlight-cards" role="list">${renderHighlightCards()}</div>
      </div>
      <div class="panel-section waitlist" aria-labelledby="waitlist-title">
        <h2 id="waitlist-title" class="subsection-title">${escapeHtml(siteConfig.copy.waitlistTitle)}</h2>
        <form id="waitlist-form" class="waitlist-form" novalidate>
          <label class="sr-only" for="waitlist-email">Email address</label>
          <input
            id="waitlist-email"
            name="email"
            autocomplete="email"
            type="email"
            placeholder="you@email.com"
            required
          />
          <button id="waitlist-submit" type="submit">Join the list</button>
        </form>
        <p id="waitlist-helper" class="helper-text"></p>
        <p id="waitlist-status" role="status" aria-live="polite" class="status-text"></p>
      </div>
    </section>
    <div class="scrim scrim-edge" aria-hidden="true"></div>
  `.trim();
}

function escapeHtml(unsafe: string) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as const;
  return unsafe.replace(/[&<>"']/g, (ch) => map[ch as keyof typeof map]);
}

/** Converts `**bold**` segments to `<strong>`; rest escaped. Newlines preserved via `.lede { white-space: pre-line }`. */
function formatLedeHtml(src: string): string {
  const re = /\*\*([\s\S]*?)\*\*/g;
  let out = '';
  let last = 0;
  for (let m = re.exec(src); m != null; m = re.exec(src)) {
    out += escapeHtml(src.slice(last, m.index));
    out += `<strong>${escapeHtml(m[1] ?? '')}</strong>`;
    last = re.lastIndex;
  }
  out += escapeHtml(src.slice(last));
  return out;
}

function renderHighlightCards(): string {
  return siteConfig.copy.highlightCards
    .map(
      (c) =>
        `<article class="highlight-card" role="listitem"><div class="highlight-card-icon-wrap" aria-hidden="true">${highlightIconSvg(c.icon)}</div><div class="highlight-card-main"><h3 class="highlight-card-title">${escapeHtml(c.title)}</h3><div class="highlight-card-body">${formatHighlightBody(c.body)}</div></div></article>`,
    )
    .join('');
}

function formatHighlightBody(body: string): string {
  return body
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p class="highlight-card-p">${escapeHtml(p)}</p>`)
    .join('');
}

function highlightIconSvg(kind: HighlightCardIcon): string {
  const common =
    'class="highlight-card-svg" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  switch (kind) {
    case 'globe':
      return `<svg ${common}><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a14 14 0 0 1 0 20M12 2a14 14 0 0 0 0 20"/></svg>`;
    case 'network':
      return `<svg ${common}><circle cx="5" cy="19" r="2"/><circle cx="19" cy="12" r="2"/><circle cx="9" cy="5" r="2"/><path d="M10.3 6.6 17.2 10.6M7.2 17.4 17.4 13"/></svg>`;
    case 'fallbacks':
      return `<svg ${common}><path d="M4 5h16M4 9h10M4 13h16M4 17h12"/><path d="M18 3v18"/></svg>`;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}
