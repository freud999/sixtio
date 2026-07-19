# Sixtio · Clarity — React prototype

Standalone **Vite + React + Telegram WebApp SDK** reproduction of the "Clarity" design
handoff (`Sixtio esign/design_handoff_sixtio_clarity/`). Faithful pixel-for-pixel port of
all four screens + compatibility sheet + settings, with the Apple-style fluid swipe.

This is an **evaluation prototype**: it is NOT wired to the Sixtio backend
(api/ · Supabase · i18n · paywall). Demo data lives in `src/lib/data.js`.

## Run

```bash
cd clarity-app
npm install
npm run dev      # http://localhost:5178
```

Open in a normal browser to evaluate, or serve over HTTPS and open inside Telegram
(@Sixtiobot Mini App) to get real theme sync + haptics.

## What's implemented

- **Feed** — editorial draggable match card. Fluid gestures ported 1:1 from the handoff:
  1:1 drag with grab-offset, photo parallax, anticipatory action buttons, momentum
  projection on release (`x + project(v)`), spring return / fly-off, rubber-banded
  vertical drag, like/nope hint stamps, tap-photo to switch shots, materialize-in.
- **Matches** — list rows, compat pills, coral "ще 6 збігів" teaser.
- **Chat** — dialog list (unread = bold), AI-hint inset.
- **Profile** — hero avatar (**real image slot**: click / drag-and-drop), profile-depth
  ring, about, psychotype, interests, achievements, **Dark Mode 18+** card (working
  toggle + age checkbox), invite, privacy.
- **Compatibility sheet** — animated score ring + count-up, verbatim verdict, paired
  Big-Five comparison with staggered reveal.
- **Settings** — full slide-in panel with grouped rows + working switches.
- **Bottom nav** — light dock + spring indigo/ember blob that lifts the active icon.
- **Theming** — light (porcelain + indigo) ⇄ dark = **ember** (warm orange), synced from
  Telegram `colorScheme` (falls back to `prefers-color-scheme`).
- **Accessibility** — three independent signals: reduced-motion, reduced-transparency,
  contrast (per Apple §14).

## Telegram integration (`src/lib/telegram.js`)

- `initTelegram()` — `ready()` + `expand()` when inside Telegram.
- theme from `WebApp.colorScheme` + `themeChanged` event (browser fallback: matchMedia).
- `haptic(kind)` — `WebApp.HapticFeedback` when available, else the Vibration API.

## Structure

```
src/
  main.jsx · App.jsx            app shell, phone frame, state, routing
  tokens.css                   theme tokens (light/dark/ember) + a11y media queries
  lib/    telegram.js  theme.js  icons.js  data.js
  components/  FeedScreen  MatchesScreen  ChatScreen  ProfileScreen
               CompatibilitySheet  SettingsScreen  BottomNav  Header  AvatarSlot  Toast
```

## Not included (backend wiring — next step if we migrate)

Real profiles from the AI-matchmaker, Telegram `initData` auth, Stars balance, i18n
(uk/ru/en), paywall/lootboxes, privacy gating of intimate tags (Dark Mode opt-in only).
