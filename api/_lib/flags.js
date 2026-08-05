// Operator kill switches (F-19 / OPS-4).
//
// Until now the app had exactly one: DARK_MODE_ENABLED. Everything else could
// only be stopped by pushing code — which, on a project that deploys straight
// to production from `main` with no CI and no staging, means the fastest way to
// stop a fire was also the riskiest thing you can do during one.
//
// A kill switch is for the hour when something is actively going wrong: a
// provider is returning garbage, a bug is corrupting profiles, spend is running
// away, a payment path is double-charging. It buys time to think without
// deleting anything or deploying anything.
//
// THREE RULES, and they are the whole file:
//
//  1. DEFAULT ON, ALWAYS. A missing or misspelled env var must never disable a
//     feature. Silence means "carry on" — the failure mode of the opposite
//     choice is an app that quietly dismantles itself because someone typo'd a
//     variable name in a dashboard at 2am.
//
//  2. OFF MEANS DEGRADE, NEVER CRASH. Each switch has a defined shape for what
//     the user sees when it is down. A flipped switch that produces a 500 is not
//     a kill switch, it is an outage with extra steps.
//
//  3. FLIPPING ONE IS AN INCIDENT. Every read of a DOWN switch alerts (throttled),
//     because the realistic way this hurts you is not the emergency — it is
//     forgetting to switch it back and discovering a month later that signups
//     have been off since Tuesday.
//
// This module has NO static imports, deliberately. Everything gates on it —
// including geminifetch.js, which until now pulled in nothing at all — and a
// gate that drags the Supabase client into every cold start is a gate that
// makes the app slower in exchange for a feature used twice a year. The alert
// path loads on demand, i.e. only when a switch is actually down.

/** Anything that plainly reads as "no" turns a switch off. Everything else is on. */
function envOn(name) {
  const raw = String(process.env[name] ?? '').trim().toLowerCase();
  return !(raw === 'false' || raw === '0' || raw === 'off' || raw === 'no');
}

// name -> what it stops, and what the user gets instead. The description is not
// decoration: it is what the alert says, so whoever sees it at 2am knows what
// they are looking at without opening the repo.
export const SWITCHES = {
  AI_ENABLED: {
    stops: 'every Anthropic call — Digital Twin, follow-ups, Big Five, photo moderation, AI reports, Why Factor',
    degrades: 'onboarding still saves answers; AI-generated text is skipped, not faked',
  },
  MATCHING_ENABLED: {
    stops: 'the matchmaker run (new AI-created pairs)',
    degrades: 'existing matches and chat keep working; no new AI pairs appear',
  },
  FEED_ENABLED: {
    stops: 'the swipe deck',
    degrades: 'the feed returns an empty deck; matches, chat and profile are untouched',
  },
  PAYMENTS_ENABLED: {
    stops: 'Telegram Stars invoices',
    degrades: 'purchase buttons refuse politely; ALREADY-PAID entitlements are honoured',
  },
  PHOTOS_ENABLED: {
    stops: 'photo upload',
    degrades: 'existing photos still serve; new uploads are refused',
  },
  TRANSLATION_ENABLED: {
    stops: 'Gemini translation',
    degrades: 'profiles show in their original language — exactly the free-tier-exhausted path, which is already handled',
  },
};

/**
 * Is this feature currently allowed to run?
 * Unknown names return true: a typo in CODE must not disable a feature either.
 */
export function flagEnabled(name) {
  const meta = SWITCHES[name];
  if (!meta) return true;
  if (envOn(name)) return true;
  // Fire-and-forget: a kill switch must never make the request it gates slower,
  // and must never fail because the alert channel is also having a bad day.
  import('./alerts.js').then(({ alertThrottled }) => {
    alertThrottled(
      `killswitch:${name}`,
      `🛑 <b>Kill switch is DOWN: ${name}</b>\n` +
      `Stopped: ${meta.stops}\n` +
      `Users see: ${meta.degrades}\n` +
      'If the incident is over, set it back to <code>true</code> and redeploy. ' +
      'This alert repeats while it stays down — that is deliberate.',
      60 * 60 * 1000,   // hourly: a nag, not a flood
    );
  }).catch(() => {});
  return false;
}

/** Every switch and its current state — for /envcheck and /stats. */
export function flagStates() {
  return Object.keys(SWITCHES).map((name) => ({ name, on: envOn(name) }));
}

/** Names of the switches currently DOWN. Empty array is the healthy answer. */
export function flagsDown() {
  return flagStates().filter((f) => !f.on).map((f) => f.name);
}
