---
"@neta-art/cohub": minor
"@neta-art/cohub-cli": minor
---

Board motion is now optional and preset-based. Boards default to no motion; the built-in `effects.deal` preset can be selected as the default enter motion (`appearance.motion.enter`) or applied to an individual node with an `on-enter` effect. `kindVersion` defaults to `1` on effect and preset input. Reduced-motion handling is preserved.

The Board-local theme registry is removed from `@neta-art/cohub/board/render`: `getBoardThemeRenderer`, `registerBoardThemeRenderer`, `BoardThemeRenderer`, `BoardThemeContext` and `cleanBoardTheme` no longer exist. The registry was never wired to `appearance.theme` and always resolved to the single built-in background; use `createBoardBackground` / `updateBoardBackground` instead. Board colors continue to come from Cohub theme tokens, and `appearance.theme` / `appearance.mood` are now optional and ignored by rendering.
