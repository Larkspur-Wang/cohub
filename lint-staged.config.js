module.exports = {
  "*.{js,ts,mts,tsx,svelte,json,jsonc}": [
    "biome check --write --no-errors-on-unmatched",
  ],
}
