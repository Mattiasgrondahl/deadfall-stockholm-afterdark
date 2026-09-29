// version.js — single source of truth for the game's public version string.
// Bumped alongside package.json "version" on each release. Shown on the title
// screen (Screens.js) so players and the deployed host can tell which build is
// live. Pure data: no DOM, no side effects, headless-safe.
export const VERSION = '3.0.0'