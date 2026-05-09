export const messaging = Object.freeze({
  headline: 'Research preview — coming soon',
  lede:
    'A controlled workspace for automated news discovery, grouping, and review so operators can see what the system found and how it was configured.',
  bullets: Object.freeze([
    'Web and news signals ingested with explicit configuration — no black-box “trust us” runs.',
    'Stories grouped for review with traceable runs and resource context.',
    'Governance-oriented operators adjust layers and providers with clear, technical surfaces.',
  ]),
  footnote:
    'This preview describes the research side only. Accounts and deployments stay private until launch readiness.',
  waitlistTitle: 'Waitlist',
  waitlistDisabledHelper:
    'Email capture activates when ops sets VITE_FORM_ENDPOINT (Formspree or Getform URL) on the hosting service and redeploys.',
  waitlistEnabledHelper:
    'We will email you when the workspace opens. There is no marketing automation wired here unless we add an ESP later.',
});
