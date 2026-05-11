export const messaging = Object.freeze({
  brandName: 'SourceHive',
  tagline:
    "The world's chaos— organized & analyzed",
  lede:
    'There is too much to follow?\nKeep up with it, so "I read that somewhere" becomes "it\'s right here." Information means nothing without order and cross reference. Catch the Links that everyone else misses.',
  bullets: Object.freeze([
    'One Information Center for sources, updates, and obscure data ready to be linked right —not scattered and lost',
    'Catch anything, from anywhere, anytime.',
    'Harvest the Power of Frontier AI Models to fully Automate Information Harvesting, Cross Referencing, Analysis & Empower actionable Recommendation',
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
