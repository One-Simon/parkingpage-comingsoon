export type HighlightCardIcon = 'globe' | 'network' | 'fallbacks';
export type HighlightLayout = 'cards' | 'bullets';

export interface HighlightCard {
  readonly title: string;
  readonly body: string;
  readonly icon: HighlightCardIcon;
}

export interface SiteConfig {
  readonly brandName: string;
  readonly pageTitle: string;
  readonly metaDescription: string;
  readonly mosaicWord: string;
  readonly assets: {
    readonly faviconSvg?: string;
    readonly faviconPng: string;
    readonly cardLogo: string;
    readonly dotGlyphTexture: string;
  };
  readonly copy: {
    readonly tagline: string;
    readonly lede: string;
    readonly highlightLayout: HighlightLayout;
    readonly highlightCards: readonly HighlightCard[];
    readonly waitlistTitle: string;
    readonly waitlistHelper: string;
    readonly waitlistStatus: {
      readonly sending: string;
      readonly success: string;
      readonly invalidEmail: string;
      readonly networkError: string;
      readonly genericError: string;
      readonly requestFailedPrefix: string;
    };
  };
}

export const siteConfig: SiteConfig = {
  brandName: 'YourBrand',
  pageTitle: 'YourBrand - coming soon',
  metaDescription:
    'A drop-in coming soon page template with an interactive WebGL background, physics typography, and an email waitlist.',
  mosaicWord: 'YOUR BRAND',
  assets: {
    faviconSvg: '/brand/favicon.svg',
    faviconPng: '/brand/favicon.png',
    cardLogo: '/brand/favicon.svg',
    dotGlyphTexture: '/brand/favicon.png',
  },
  copy: {
    tagline: 'A better way to launch is coming soon.',
    lede: 'A focused product experience is almost ready.\nUse this template to ship a polished **coming soon** page with an interactive WebGL background, physics typography, and an email waitlist.',
    highlightLayout: 'cards',
    highlightCards: Object.freeze([
      {
        title: 'Ready to rebrand',
        body: 'Swap the copy, colors, favicon, and mosaic word in a few focused files.',
        icon: 'globe',
      },
      {
        title: 'Static by default',
        body: 'Deploy the built assets anywhere that serves static files. Render, Netlify, Vercel, Cloudflare Pages, S3, and GitHub Pages all work.',
        icon: 'network',
      },
      {
        title: 'Accessible fallbacks',
        body: 'The DOM content stays readable, reduced-motion users get a static fallback, and the canvas is hidden from assistive technology.',
        icon: 'fallbacks',
      },
    ]),
    waitlistTitle: 'Get launch updates',
    waitlistHelper: 'Your email is only used for launch updates. Unsubscribe any time.',
    waitlistStatus: {
      sending: 'Sending...',
      success: 'Thanks, you are on the list.',
      invalidEmail: 'Enter a valid email address.',
      networkError: 'Network blocked or offline.',
      genericError: 'Could not submit. Try again.',
      requestFailedPrefix: 'Request failed',
    },
  },
};
