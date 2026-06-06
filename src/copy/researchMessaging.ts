export type HighlightCardIcon = 'globe' | 'pipeline' | 'sources';

export interface HighlightCard {
  readonly title: string;
  readonly body: string;
  readonly icon: HighlightCardIcon;
}

export const messaging = Object.freeze({
  brandName: 'SourceHive',
  tagline:
    "The world's chaos— organized & analyzed",
  lede:
    'There is too much to follow? - **Keep up with it.**\nCentralize OSINT collection, structure & analysis so Information turns into decisions, not noise.\nBuild **agentic workflows** on Agent workflow optimized infrastructure using **non-generative AI** that links signals competitors treat as unrelated.\nInformation means nothing without order and cross reference | **Catch the Links that everyone else misses.**',
  highlightCards: Object.freeze([
    {
      title: 'Any source, any time',
      body: 'Catch anything, from anywhere, anytime.',
      icon: 'globe',
    },
    {
      title: 'Automate & connect',
      body:
        'Automate harvesting, cross-reference, analysis, and recommendations—frontier models, OSINT-wide.\n\nInnovation stack: agentic workflows on vector/graph + entity relations; finetuned open-weight models for context-tight linking of unrelated signals',
      icon: 'pipeline',
    },
    {
      title: 'Built for the open web',
      body:
        'Built for messy open data—news, social, and the wider web—not spreadsheet BI on data that was already tidy',
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
