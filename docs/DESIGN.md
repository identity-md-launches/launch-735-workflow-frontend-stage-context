# Genesis Protocol design

## Overview

The dashboard serves GENESIS holders and people exploring the attested Sepolia token. It uses an intentionally dark, olive-neutral workspace with pale green actions, open spacing and compact financial readouts. The sidebar establishes product/navigation context; the main hierarchy is heading, testnet notice, metrics, protocol introduction and swap, pool state, token tools/activity, then deployment details.

This file documents the final React source, not a proposed redesign. It is under `docs/` because the assignment permits `web/**`, `dist/**`, and `docs/**` but forbids creating root `DESIGN.md`.

## Colors

Canonical values are in `web/src/tokens.css`. They use hex for reproducible sRGB values and semantic names:

| Tokens                                       | Values                                     | Purpose                                            |
| -------------------------------------------- | ------------------------------------------ | -------------------------------------------------- |
| `--bg`, `--sidebar`                          | `#10130f`, `#111410`                       | Page and fixed navigation                          |
| `--surface`, `--surface-raised`, `--field`   | `#171b15`, `#22271f`, `#12160f`            | Cards, secondary controls, inset fields            |
| `--hover`, `--selection`                     | `#2c3427`, `#252e1c`                       | Hover and selected navigation/action mode          |
| `--text`, `--muted`                          | `#eef0e8`, `#a0a697`                       | Main and secondary text                            |
| `--border`, `--border-control`               | `#2a3025`, `#56604d`                       | Group structure and interactive outlines           |
| `--accent`, `--accent-hover`, `--accent-ink` | `#d4ef8d`, `#e1f6b0`, `#182112`            | Primary swap action and link hierarchy             |
| `--focus`                                    | `#dcf7a1`                                  | 2 px keyboard focus outline, 4 px offset           |
| `--status`, `--warning`, `--danger`          | `#95cbbb`, `#efc58f`, `#ffb0a5`            | Status with text, recoverable warnings, errors     |
| `--feature`, `--feature-border`              | `#25291b`, `#424a30`                       | Protocol introduction surface and orbit details    |
| `--feature-text`, `--feature-muted`          | `#e6ebd0`, `#b9bfa5`                       | Introduction text                                  |
| `--coin`, `--coin-ink`, `--eth`, `--eth-ink` | `#d5dfac`, `#2b3519`, `#323849`, `#d1d8f1` | Token identities, separate from interaction status |

There is one filled primary action in the swap panel. Navigation selection and token identity use distinct shapes. Status is always accompanied by words. Measured rendered solid-surface text ratios are recorded in `evidence/contrast.json`; axe findings are recorded per tested width. Decorative artwork contrast is not a certification of every composite pixel. No alternate light theme is implemented.

## Typography

`web/src/style.css` uses Arial, Helvetica, sans-serif. It has no downloadable font. System monospace is used for contract identifiers; exact font availability follows the browser/OS. Body text is 14 px with 1.6 line-height; inputs are 16 px to avoid small-input mobile zoom. Common labels and supporting text are 12 px. Decorative wordmark sublabels and a small mobile feature footer use 8 px; they carry no necessary instructions.

The primary heading is `clamp(28px, 2.6vw, 40px)`, with 1.2 line-height and -1.4 px tracking; mobile overrides use 34 px and 29 px. Panel headings are 20 px (19 px at the smallest breakpoint). The feature headline uses 24–33 px, with mobile overrides of 32/30 px. Metric figures use 22–30 px (16–22 px on narrow phones) and tabular numerals; amounts use 28–30 px. Body text is regular, controls/selected items typically 600, headings mostly 500. Headings balance wrapping; prose uses `text-wrap: pretty`. Long identifiers use `overflow-wrap: anywhere` and can be inspected in full. Supply and quote outputs use locale formatting, while review panels retain exact decimal strings.

## Layout

Primary layout and components live in `web/src/style.css` and `web/src/App.tsx`. The desktop sidebar is 222 px, topbar is at least 86 px high, and content has 38 px gutters with a 1390 px maximum width. Repeated cards use 16–24 px gaps; panel padding is 20–24 px; controls use 8–12 px internal spacing. Three metric columns precede a 1.38:1 main grid. Token tools and activity are equal-width columns. Everything remains in normal page flow except desktop navigation.

Implemented breakpoints:

- Above 1500 px: 48 px content gutters and larger decorative feature art.
- At 1180 px: 190 px sidebar, 24 px gutters, tighter main grid.
- At 960 px: 76 px icon rail with accessible link text retained.
- At 740 px: horizontal brand/navigation row, 20 px gutters, one content column. Introduction, swap and pool appear in that order. Tools/activity also stack.
- At 430 px: 16 px gutters, metrics become individual label/value rows, reduced header navigation, wrapped pool statistics and identifiers.

Rendered checks cover 1440, 960, 740, 390 and 320 CSS pixels with no horizontal document overflow. The production export works under `/preview/` with relative resources. Native browser zoom, physical-device behavior, translated content and RTL mirroring were not manually verified. Navigation is by in-page anchors; there is no hidden routing state.

## Elevation & Depth

This is a flat interface. Tonal surfaces, inset fields and 1 px borders establish grouping. It has no modal overlay or large drop shadows. The swap direction button overlaps two input surfaces with a border matching the outer surface. The feature panel clips decorative orbit artwork; its text remains in an independent foreground layer.

## Shapes

Cards use 10–12 px corner radii. Fields use 8–10 px, buttons 8 px, tags 4–5 px and token marks circles. Small icon buttons have at least 32 px hit targets; primary actions use 44 px minimum height. Brand graphics in `web/public/genesis.svg` and the inline feature SVG in `App.tsx` are locally authored vectors. The orbit diagram is decorative and `aria-hidden`. Lucide icons use one visual family and inherit foreground color.

## Components

- `components.tsx`: `External` adds an outbound arrow and new-tab accessible text; `AddressLink` supplies checksum formatting, explorer linking, full-address title/copy and clipboard fallback; `Metric` gives label/value/detail structure; `Busy` supplies action text plus opt-in motion; `ErrorText` keeps errors inline and announces them.
- `Swap.tsx`: pay/receive field pair, reverse direction, slippage input, quote details and a single primary action. It advances through connect, switch, quote, approval, authorization and execution states. Pending actions lock until confirmation. Form/account changes invalidate quotes, and all errors remain visible near the controls.
- `TokenTools.tsx`: native pressed-state buttons choose Send, Allowance or Transfer from. Inputs have persistent labels and errors; inline review shows full target address/amount before signing. No modal is needed, so there is no overlay focus trap.
- `App.tsx`: panel headings, badges, pool details, honest metric empty states, session activity, testnet notice and attestation disclosures. Native `details/summary` handles progressive disclosure and keyboard activation.
- `useDashboard.ts`: centralized read/transaction states. Every pending label is specific to its action; a shared exclusion lock prevents concurrent transaction requests without mislabeling unrelated controls.

Native buttons/links and a skip link preserve keyboard navigation. The focus outline is visible and remains enabled in forced-colors mode. Hover styling is gated by pointer capability. Under reduced motion, smooth scrolling and spinner rotation stop. Otherwise button transitions last 120 ms and press scale is 0.96. There are no entrance animations or autoplay media.

## Do's and Don'ts

Reuse `.panel`, `.panel-heading`, `.eyebrow`, `.between`, `.caption` and the shared link/error patterns for another section. Put it in the existing grid/normal document order, use a descending heading, and verify at 320 px. Pick the primary style only for the active swap action; use bordered secondary controls for token tools and disclosures.

Keep runtime deployment values in the fetched manifest and ABIs. Keep exact values reachable in reviews and address details. Preserve token units and explicit unavailable states. Do not add invented prices, circulating allocations, historical charts or success claims to fill empty space. Do not turn a public data error into an enabled transaction button.

Design guidance was adapted from Jakub Krehel's Better Interface (MIT, commit `267330e1adfc66a718fb65fa6918c1f06d0a689e`). This documentation follows the adapted method of Paul Bakaus's Impeccable (Apache-2.0, commit `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8`). Copyright 2025 Paul Bakaus. Local license texts are retained in `BETTER-INTERFACE-LICENSE.txt`. Ethereum interaction guidance was adapted from Austin Griffith's ethskills at `06ea4efa0807`; see `ETH-FRONTEND-UX-LICENSE.txt`.
