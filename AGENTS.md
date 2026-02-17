# AGENTS.md — AI Agent Context for BeanLog

> This file provides context for AI coding agents (Codex, Copilot, etc.).
> For Cursor-specific rules, see `.cursorrules`.

## Quick Reference

| Aspect | Detail |
|---|---|
| **Framework** | React 18 + TypeScript + Vite 5 |
| **Styling** | Tailwind CSS 3 (amber accent) |
| **Backend** | Supabase (Auth + Postgres + RLS) |
| **i18n** | Custom (`useI18n()` hook, `en-us` + `ko-kr`) |
| **State** | Local `useState` only (no global store) |
| **Exports** | Named exports only (no default exports except `App.tsx`) |

## Architecture

```
src/
├── analysis/       # Computer vision tab (OpenCV Web Worker)
├── auth/           # Supabase Auth (signup/login/logout)
├── components/     # Shared UI (ImageUpload, ResultsDisplay)
├── config/         # Supabase client singleton
├── i18n/           # Internationalization (context + locale files)
├── logging/        # Main feature: brew journal
│   ├── components/ # Reusable UI (AutocompleteInput, FlavorWheelPicker, NoteDotsList, StarRating)
│   ├── hooks/      # Data-fetching hooks (useBeanSuggestions, useGrinderSuggestions)
│   ├── pages/      # Full page components (NewBrewPage, HistoryPage, etc.)
│   ├── utils/      # Pure helpers (formatting.ts, beanLabel.ts, brewPng.ts)
│   └── types.ts    # Domain types (BeanInput, BrewInput, *Row)
└── workers/        # OpenCV Web Worker
```

## Key Conventions

1. **Always use `useI18n()`** for user-visible text — never hardcode strings.
2. **Shared utilities** live in `src/logging/utils/` — import from there, never duplicate.
3. **Database IDs** are client-generated UUIDs via `crypto.randomUUID()`.
4. **RLS is enforced** — no need for manual `user_uid` filters in queries.
5. **Temperatures** are stored in Celsius (`water_temp_c`). UI supports F↔C toggle.
6. **Form state** uses string types parsed to numbers on save via `toNullableNumber()`.
7. **SCA flavor notes** use a 3-level cascading picker stored as `FlavorNote[]` JSONB.

## Schema Changes

Always create a dated patch file in `supabase/` alongside updating `schema.sql`.

## Do Not Touch

- `src/workers/cv.worker.ts` — complex OpenCV pipeline, only modify if explicitly asked.
- `src/logging/scaFlavorWheel.ts` — SCA taxonomy data, rarely changes.

