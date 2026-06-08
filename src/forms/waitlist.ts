import { siteConfig } from '../brand/siteConfig.ts';

type WaitlistState = 'idle' | 'loading' | 'success' | 'error' | 'disabled';

const EMAIL_RE =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

interface WaitlistElements {
  form: HTMLFormElement;
  input: HTMLInputElement;
  button: HTMLButtonElement;
  helper: HTMLParagraphElement;
  status: HTMLParagraphElement;
}

export function bindWaitlist(host: HTMLElement): WaitlistElements {
  const endpoint = normalizeEndpoint(import.meta.env.VITE_FORM_ENDPOINT);
  const hasEndpoint = endpoint != null;

  const form = host.querySelector<HTMLFormElement>('#waitlist-form');
  const input = host.querySelector<HTMLInputElement>('#waitlist-email');
  const button = host.querySelector<HTMLButtonElement>('#waitlist-submit');
  const helper = host.querySelector<HTMLParagraphElement>('#waitlist-helper');
  const status = host.querySelector<HTMLParagraphElement>('#waitlist-status');

  if (!(form && input && button && helper && status)) {
    throw new Error('waitlist.mount_failed');
  }

  helper.textContent = siteConfig.copy.waitlistHelper;
  button.disabled = !hasEndpoint;
  button.setAttribute('aria-disabled', String(!hasEndpoint));
  status.textContent = '';

  let state: WaitlistState = hasEndpoint ? 'idle' : 'disabled';
  let lastSubmitAt = 0;
  /** Soft throttle to prevent accidental double-POSTs from rapid clicks / Enter spam. */
  const SUBMIT_THROTTLE_MS = 1500;

  const setState = (next: WaitlistState, message = '') => {
    state = next;
    switch (next) {
      case 'idle':
        status.textContent = '';
        input.disabled = false;
        button.disabled = false;
        break;
      case 'loading':
        status.textContent = siteConfig.copy.waitlistStatus.sending;
        input.disabled = true;
        button.disabled = true;
        break;
      case 'success':
        status.textContent = siteConfig.copy.waitlistStatus.success;
        input.value = '';
        input.disabled = false;
        button.disabled = false;
        break;
      case 'error':
        status.textContent = message || siteConfig.copy.waitlistStatus.genericError;
        input.disabled = false;
        button.disabled = false;
        break;
      case 'disabled':
      default:
        status.textContent = '';
        input.disabled = true;
        button.disabled = true;
        break;
    }
    form.setAttribute('data-waitlist-state', next);
  };

  if (!hasEndpoint) {
    setState('disabled');
  }

  form.addEventListener(
    'submit',
    async (ev) => {
      ev.preventDefault();
      if (!hasEndpoint || state === 'loading') return;
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (now - lastSubmitAt < SUBMIT_THROTTLE_MS) return;
      const raw = input.value.trim();
      if (!EMAIL_RE.test(raw)) {
        status.textContent = siteConfig.copy.waitlistStatus.invalidEmail;
        return;
      }
      lastSubmitAt = now;
      setState('loading');
      const body = new FormData();
      body.append('email', raw);
      body.append('_gotcha', '');

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { Accept: 'application/json' },
          body,
        });
        if (!res.ok) {
          let msg = `${siteConfig.copy.waitlistStatus.requestFailedPrefix} (${res.status}).`;
          try {
            const data = await res.json();
            if (data.errors && typeof data.errors === 'object') {
              const first = formatFieldErrors(data.errors);
              if (first) msg = first;
            } else if (typeof data.message === 'string') {
              msg = data.message;
            } else if (typeof data.error === 'string') {
              msg = data.error;
            }
          } catch {
            /* noop */
          }
          setState('error', msg);
          input.focus({ preventScroll: true });
          return;
        }

        try {
          const okJson = await res.json();
          if ('ok' in okJson && okJson.ok !== true && typeof okJson.errors === 'object') {
            const firstErr = formatFieldErrors(okJson.errors as Record<string, unknown>);
            if (firstErr) {
              setState('error', firstErr);
              input.focus({ preventScroll: true });
              return;
            }
          }
        } catch {
          /* some providers reply with plain 200 text */
        }
        setState('success');
      } catch {
        setState('error', siteConfig.copy.waitlistStatus.networkError);
        input.focus({ preventScroll: true });
      }
    },
    { passive: false },
  );

  return { form, input, button, helper, status };
}

function formatFieldErrors(errors: Record<string, unknown>) {
  for (const [key, payload] of Object.entries(errors)) {
    if (!payload) continue;
    if (Array.isArray(payload) && payload.length > 0) {
      return `${key}: ${String(payload[0])}`;
    }
    if (typeof payload === 'string') {
      return `${key}: ${payload}`;
    }
  }
  return '';
}

function normalizeEndpoint(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const endpoint = value.trim();
  if (!endpoint) return null;
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}
