# Theme Implementation Guide

Use this checklist when adding or changing UI in the dashboard surface.

## Core Rule

Theme support is not complete unless the new element changes correctly when the
selected theme changes. Avoid hard-coded `#fff`, `#111`, or one-off colors for
new surfaces unless the element is intentionally neutral.

If you are adding a task, project, or session surface, keep the identity stable:
use the existing task icon and tone patterns so the same item keeps the same
visual language across insights, timesheet, notes, and task cards.

## Use The Theme Tokens

The dashboard theme classes expose shared tokens through CSS variables:

- `--theme-bg`
- `--theme-page`
- `--theme-sidebar`
- `--theme-panel`
- `--theme-panel-alt`
- `--theme-ink`
- `--theme-muted`
- `--theme-subtle`
- `--theme-accent`
- `--theme-accent-2`
- `--theme-danger`
- `--theme-shadow`
- `--theme-radius`

Prefer those tokens for:

- Panel backgrounds
- Card backgrounds
- Input and select backgrounds
- Label and helper text
- Borders and dividers
- Hover and focus states
- Danger or warning states

## Surface Mapping

Use this as the default mapping when styling new UI:

- Main card or panel: `var(--theme-panel)`
- Secondary chip or control surface: `var(--theme-panel-alt)`
- Primary text: `var(--theme-ink)`
- Secondary text and labels: `var(--theme-muted)`
- Lines and borders: `var(--theme-subtle)`
- Primary action: `var(--theme-accent)`
- Secondary emphasis: `var(--theme-accent-2)`
- Destructive action: `var(--theme-danger)`

Prefer the existing grid layouts for new dashboard panels instead of introducing
fixed-width columns. The current settings and profile surfaces use named panel
regions that collapse cleanly on smaller screens.

## New Controls

When adding inputs, selects, textareas, or button groups:

- Give them a themed background instead of assuming white.
- Set text color from `--theme-ink`.
- Set placeholder and helper text from `--theme-muted`.
- Make focus rings use the theme accent, not a fixed blue.
- Verify contrast in the dark theme first, then in the lightest theme.

## New Panels And Dialogs

When adding a dialog, drawer, or settings card:

- Theme the container and its controls together.
- Reuse existing panel spacing and radius so the new surface feels part of the
  same system.
- Do not leave modal content on a hard-coded white surface if the rest of the
  workspace is theme-driven.
- Check nested content like labels, captions, and empty states. These are the
  most common places for dark-theme regressions.

## Review Checklist

Before shipping a new UI surface, check:

1. Does it still read clearly in `dark-studio`?
2. Does it feel consistent in `old-money`, `retro-console`, and
   `color-blind`?
3. Are labels, helper text, and placeholders visible?
4. Do borders and controls still have enough contrast?
5. Does the focus state use the theme accent?
6. Is any new overlay or dialog using the same surface language as the rest of
   the app?
7. Do task or session identities remain stable between list, chart, and detail
   views?

## Current Example Patterns

- Backup cards and theme cards already use theme-driven panels correctly.
- The local AI model field and entry editor now follow the same token rules.
- If you add another settings block, match those patterns instead of creating a
  new visual system.
