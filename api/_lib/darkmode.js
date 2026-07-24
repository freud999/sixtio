// Dark Mode (18+) — availability, consent, and the operator kill switch.
//
// Three separate gates have to be open before a single intimate marker moves
// between two people. This module owns all three so no endpoint can accidentally
// check only two of them:
//
//   1. DARK_MODE_ENABLED   — operator kill switch. One env var takes the whole
//                            18+ layer offline everywhere, without a deploy that
//                            touches matching logic.
//   2. dark_mode_active    — the user's own switch (migration 011).
//   3. consent, current    — an affirmative, recorded, VERSIONED consent
//                            (migration 030). A stale version is treated as no
//                            consent at all.
//
// Disclosure itself is symmetric and free: neither gender pays for it, and the
// paywall (entitlements.blur) deliberately does NOT reach this layer.

import { getSupabase } from './supabase.js';

// Bump whenever the consent copy changes materially. Everyone who agreed to an
// older wording is re-asked, because they never saw the text that now applies.
// v1 = the two-stage disclosure screen: shared markers in the feed, full lists
// after a mutual match.
export const DARK_CONSENT_VERSION = 'v1';

/**
 * Operator kill switch. Defaults to ON — the layer only goes dark when someone
 * explicitly says so, so a missing env var can never silently disable a feature
 * users already opted into.
 */
export function darkModeEnabled() {
  const raw = String(process.env.DARK_MODE_ENABLED ?? '').trim().toLowerCase();
  return !(raw === 'false' || raw === '0' || raw === 'off' || raw === 'no');
}

/** True when this user agreed to the consent text that is currently in force. */
export function hasCurrentConsent(user) {
  return !!(user && user.dark_consent_at && user.dark_consent_version === DARK_CONSENT_VERSION);
}

/**
 * The single question every read path should ask: may this user's intimate data
 * participate right now? Requires all three gates. Pass a users row that
 * includes dark_mode_active, dark_consent_at and dark_consent_version.
 */
export function darkActive(user) {
  return darkModeEnabled() && !!(user && user.dark_mode_active) && hasCurrentConsent(user);
}

/**
 * True when the user is inside the layer but agreed to superseded wording (e.g.
 * the pre-v1 'legacy' flow). Their data is withheld until they re-consent — the
 * UI uses this to explain why instead of showing an unexplained empty state.
 */
export function consentStale(user) {
  return !!(user && user.dark_mode_active) && !hasCurrentConsent(user);
}

/**
 * Records the affirmative consent + the separate 18+ affirmation, then activates
 * the layer. The two timestamps are written together because the screen collects
 * both in one act, but they are stored apart: they are different statements.
 */
export async function recordDarkConsent(userId) {
  const now = new Date().toISOString();
  const { error } = await getSupabase()
    .from('users')
    .update({
      dark_mode_active: true,
      dark_consent_at: now,
      dark_consent_version: DARK_CONSENT_VERSION,
      dark_age_confirmed_at: now,
    })
    .eq('id', userId);
  if (error) throw error;
}

// The columns every endpoint must select to evaluate darkActive(). Kept here so
// a new read path can't forget one and silently fall back to "no consent".
export const DARK_COLUMNS = 'dark_mode_active, dark_consent_at, dark_consent_version';
