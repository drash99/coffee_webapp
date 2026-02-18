# AGENTS.md — AI Agent Context for BeanLog

> This file provides context for AI coding agents (Codex, Copilot, etc.).
> For Cursor-specific rules, see `.cursorrules`.

## Quick Reference

| Aspect | Detail |
|---|---|
| **Framework** | React 18 + TypeScript + Vite 5 |
| **Styling** | Tailwind CSS 3 (amber-700 accent) |
| **Backend** | Supabase (Auth + Postgres + RLS) — optional; guest mode uses localStorage |
| **Mobile** | Capacitor 8 (single codebase → web + iOS + Android) |
| **CV** | OpenCV.js (WASM) in Web Worker — works on all platforms |
| **i18n** | Custom (`useI18n()` hook, `en-us` + `ko-kr`) |
| **State** | Local `useState` only (no global store) |
| **Exports** | Named exports only (no default exports except `App.tsx`) |

## Architecture

```
src/
├── platform/       # ★ Capacitor abstraction (camera, haptics, platform detect)
├── analysis/       # Computer vision tab (OpenCV Web Worker)
├── auth/           # Supabase Auth (signup/login/logout)
├── components/     # Shared UI (ImageUpload, ResultsDisplay)
├── config/         # Supabase client singleton
├── i18n/           # Internationalization (context + locale files)
├── logging/        # Main feature: brew journal
│   ├── storage/    # ★ Guest mode localStorage CRUD + migration to Supabase
│   ├── components/ # Reusable UI (AutocompleteInput, FlavorWheelPicker, NoteDotsList, StarRating, TabButton)
│   ├── hooks/      # Data-fetching hooks (useBeanSuggestions, useGrinderSuggestions)
│   ├── pages/      # Full page components (NewBrewPage, HistoryPage, etc.)
│   ├── utils/      # Pure helpers (formatting.ts, beanLabel.ts, brewPng.ts)
│   └── types.ts    # Domain types (BeanInput, BrewInput, *Row)
└── workers/        # OpenCV Web Worker
android/             # Capacitor Android project (managed by `cap sync`)
ios/                 # Capacitor iOS project (managed by `cap sync`)
supabase/            # DB schema + migrations
```

## Key Conventions

1. **Always use `useI18n()`** for user-visible text — never hardcode strings.
2. **Shared utilities** live in `src/logging/utils/` — import from there, never duplicate.
3. **Database IDs** are client-generated UUIDs via `crypto.randomUUID()`.
4. **RLS is enforced** — no need for manual `user_uid` filters in queries.
5. **Temperatures** are stored in Celsius (`water_temp_c`). UI supports F↔C toggle.
6. **Form state** uses string types parsed to numbers on save via `toNullableNumber()`.
7. **SCA flavor notes** use a 3-level cascading picker stored as `FlavorNote[]` JSONB.
8. **Platform-specific code** goes through `src/platform/` — never import `@capacitor/*` directly in components.
9. **Cascade deletes** — deleting a bean also deletes all its brews (DB constraint + local mirror).
10. **Guest mode** — pages accept `isGuest` prop; when `true`, CRUD routes to `src/logging/storage/localDb.ts`. Share-brew is hidden. Migration to Supabase happens via `migrateLocalToSupabase()` on signup.

## Mobile Workflow

```bash
npm run build          # Build web → dist/
npm run cap:sync       # Build + copy to ios/ & android/
npm run cap:android    # Open Android Studio
npm run cap:ios        # Open Xcode (macOS only)
```

## Platform Abstraction (`src/platform/`)

| Function | Native | Web |
|---|---|---|
| `isNative()` | `true` | `false` |
| `getPlatform()` | `'ios'` / `'android'` | `'web'` |
| `pickImageNative()` | OS camera/gallery picker → `File` | returns `null` |
| `hasNativeCamera()` | `true` | `false` |
| `hapticTap()` | Light vibration | no-op |
| `hapticImpact()` | Medium vibration | no-op |

## Schema Changes

Always create a dated patch file in `supabase/` alongside updating `schema.sql`.

## Do Not Touch

- `src/workers/cv.worker.ts` — complex OpenCV pipeline, only modify if explicitly asked.
- `src/logging/scaFlavorWheel.ts` — SCA taxonomy data, rarely changes.
- `android/` and `ios/` — managed by Capacitor; only edit for native config (permissions, icons).
