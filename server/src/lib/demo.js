// "Demo mode" shows the one-time client code on screen and lets the sign-in pages offer demo accounts.
// It is on outside production, and on Vercel unless DEMO_MODE=0 (the Vercel deployment keeps throw-away demo data).
export const isDemo = () =>
  process.env.DEMO_MODE === '1' || (process.env.DEMO_MODE !== '0' && (process.env.NODE_ENV !== 'production' || !!process.env.VERCEL));
