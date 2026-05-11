export const messaging = Object.freeze({
  eyebrow: 'Early access',
  brandName: 'SourceHive',
  tagline: 'Research, organize, and analyze information—not just read and forget.',
  lede:
    'SourceHive is built for people who work with real material: news, documents, feeds, datasets, and notes. Gather what matters, structure it your way, and spot connections without living in a dozen tabs.',
  bullets: Object.freeze([
    'One place to pull in sources and threads—articles, alerts, files, and quantitative bits you need side by side.',
    'Organize and revisit your research stack so context stays attached to ideas, not lost in history.',
    'Analyze and compare across materials when you need signal, not another passive feed.',
  ]),
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
