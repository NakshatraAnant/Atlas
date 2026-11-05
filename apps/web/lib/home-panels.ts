// Home panels a user can show, hide and reorder in Settings (ids match the API's HOME_PANELS).
export const PANELS: [string, string, string][] = [
  ['attention', 'What changed', 'New data releases and the largest recent moves'],
  ['following', 'Followed series', 'Latest values of the series you follow'],
  ['indices', 'Indian indices', 'NIFTY 50, SENSEX, NIFTY BANK (end of day)'],
  ['commodities', 'Commodities', 'Oil, gas and copper benchmarks'],
  ['macro', 'Macro', 'Rates, inflation, labour, the rupee'],
  ['crypto', 'Digital assets', 'Reference prices for major assets'],
  ['learning', 'Learning', 'Your level, XP and next Academy step'],
];
export const DEFAULT_PANELS = PANELS.map((p) => p[0]);
