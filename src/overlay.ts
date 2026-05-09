import { messaging } from './copy/researchMessaging.ts';

/** Insert marketing card DOM into `#ui-root` */
export function mountOverlay(root: HTMLElement) {
  root.className = 'ui-stack';

  root.innerHTML = `
    <div class="scrim scrim-behind-cards" aria-hidden="true"></div>
    <section class="glass-card" aria-labelledby="hero-heading">
      <span class="eyebrow">SourceHive · early access</span>
      <h1 id="hero-heading" class="headline">${escapeHtml(messaging.headline)}</h1>
      <p class="lede">${escapeHtml(messaging.lede)}</p>
      <ul class="bullet-list">${messaging.bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join('')}</ul>
      <p class="footnote">${escapeHtml(messaging.footnote)}</p>
      <div class="waitlist" aria-labelledby="waitlist-title">
        <h2 id="waitlist-title" class="subsection-title">${escapeHtml(messaging.waitlistTitle)}</h2>
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
      <footer class="legal-hint">Preview only — no accounts or logins here yet.</footer>
    </section>
    <div class="scrim scrim-edge" aria-hidden="true"></div>
  `.trim();

  bindFocusTrapShortcuts(root.querySelector('#waitlist-form'));
}

function escapeHtml(unsafe: string) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as const;
  return unsafe.replace(/[&<>"']/g, (ch) => map[ch as keyof typeof map]);
}

function bindFocusTrapShortcuts(formEl: Element | null) {
  const form = formEl as HTMLFormElement | null;
  if (!(form instanceof HTMLFormElement)) return;
  form.addEventListener(
    'keydown',
    (e) => {
      if (!(e.target instanceof HTMLElement)) return;
      if (
        ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(e.target.tagName) ||
        e.target.isContentEditable
      ) {
        e.stopPropagation();
      }
    },
    false
  );
}

