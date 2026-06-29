# Theme Exploration

This branch explores six visual directions for Ream without changing core
workflows. The themes are selectable from Backup & settings and persist in
local storage.

## Directions

### Classic Old Money

- Tone: restrained, desk-calendar, private office.
- Palette: ivory, deep green, oxblood, brass, muted stone.
- Fit: safest default for a productivity app because it stays quiet during long
  work sessions.

### 90s Console

- Tone: playful, chunky, saturated, cartridge-era UI.
- Palette: warm cream, primary red, saturated blue, yellow status accents.
- Fit: good for personality, but best as an optional theme because the hard
  edges and high saturation are louder than the default workspace.

### Old Indian Painting

- Tone: parchment, miniature-painting pigment, ornamental but still structured.
- Palette: aged paper, indigo, vermillion, malachite, ochre.
- Fit: distinct and warm. It needs restrained decoration so task lists remain
  scannable.

### Manga Ink

- Tone: black ink, paper, screentone, sharp action accent.
- Palette: near-white paper, black ink, grey screentone, red action color.
- Fit: strong identity. Good for users who like contrast and comic styling, but
  should avoid noisy patterns in dense tables.

### Dark Studio

- Tone: low-glare, late-session, focused.
- Palette: charcoal, slate, teal, amber.
- Fit: practical dark theme for evening work. Avoids a pure black canvas so
  cards and controls still have depth.

### Color-Blind Friendly

- Tone: neutral, high-contrast, operational.
- Palette: off-white, blue, orange, sky blue, magenta danger.
- Fit: accessibility-first option. State should not depend only on red/green;
  labels, icons, and contrast remain primary.

## Implementation Notes

- The theme state lives in `MainView` and persists to `localStorage`.
- Theme classes are attached to `.dashboard-shell`, keeping the experiment local
  to the main app surface.
- CSS variables define shared surfaces, ink, muted text, accents, danger, shadow,
  and corner radius.
- New UI surfaces should follow `docs/theme-implementation-guide.md` so theme
  selection is accounted for when controls, dialogs, or settings panels are
  added later.
- The overlay keeps its current style for now; it should get the same theme
  tokens only after the main workspace direction is chosen.

## Next Decisions

- Pick one default and two alternates before expanding the settings surface.
- Decide whether overlay theming should mirror the main workspace or remain
  intentionally neutral.
- Add a reduced-motion and high-contrast pass if themes graduate from spike to
  product feature.
