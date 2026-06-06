export type HighlightCardIcon = 'globe' | 'pipeline' | 'sources';

export interface HighlightCard {
  readonly title: string;
  readonly body: string;
  readonly icon: HighlightCardIcon;
}

export const messaging = Object.freeze({
  brandName: 'YourBrand',
  tagline: 'A better way to launch is coming soon.',
  lede:
    'A focused product experience is almost ready.\nUse this template to ship a polished **coming soon** page with an interactive WebGL background, physics typography, and an email waitlist.',
  highlightCards: Object.freeze([
    {
      title: 'Ready to rebrand',
      body: 'Swap the copy, colors, favicon, and mosaic word in a few focused files.',
      icon: 'globe',
    },
    {
      title: 'Static by default',
      body:
        'Deploy the built assets anywhere that serves static files. Render, Netlify, Vercel, Cloudflare Pages, S3, and GitHub Pages all work.',
      icon: 'pipeline',
    },
    {
      title: 'Accessible fallbacks',
      body:
        'The DOM content stays readable, reduced-motion users get a static fallback, and the canvas is hidden from assistive technology.',
      icon: 'sources',
    },
  ] satisfies readonly HighlightCard[]),
  waitlistTitle: 'Get launch updates',
  /** Shown under the email field for both enabled and disabled waitlist. */
  waitlistHelper:
    'Your email is only used for launch updates. Unsubscribe any time.',
  waitlistStatus: Object.freeze({
    sending: 'Sending…',
    success: 'Thanks — you are on the list.',
    invalidEmail: 'Enter a valid email address.',
    networkError: 'Network blocked or offline.',
    genericError: 'Could not submit. Try again.',
    requestFailed: (status: number) => `Request failed (${status}).`,
  }),
});
