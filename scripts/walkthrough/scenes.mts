// The ATLAS product walkthrough: what is shown and said, scene by scene. Every scene drives the real,
// locally running app (real-data mode); narration describes only what is on screen and what the app
// actually does. Title and closing cards are drawn by the composer (no app page behind them).
import type { Page } from 'playwright';

export interface Helpers {
  go: (path: string) => Promise<void>;
  scroll: (px: number, ms?: number) => Promise<void>;
  wait: (ms: number) => Promise<void>;
  hover: (sel: string) => Promise<void>;
  click: (sel: string) => Promise<void>;
  moveTo: (x: number, y: number, ms?: number) => Promise<void>;
  type: (text: string, perCharMs?: number) => Promise<void>;
}

export interface Scene {
  id: string;
  chapter: string;
  narration: string;
  /** 'card' scenes are drawn by the composer; 'app' scenes record the browser. */
  kind: 'card' | 'app';
  card?: { title: string; lines: string[] };
  viewport?: { width: number; height: number };
  run?: (page: Page, h: Helpers) => Promise<void>;
}

export const SCENES: Scene[] = [
  {
    id: 'intro', chapter: 'ATLAS', kind: 'card',
    card: { title: 'ATLAS', lines: ['Financial research workspace', 'Indian and global markets · macro · commodities · digital assets', 'Local build · real-data mode · synthetic narration voice'] },
    narration: 'This is ATLAS, a financial research workspace for Indian and global markets. Everything you will see is the local build running on this computer, using real data from named sources. The narration is a synthetic computer voice.',
  },
  {
    id: 'home', chapter: 'Home', kind: 'app',
    narration: 'After signing in, Home shows a snapshot built only from stored observations. Each figure carries the date it refers to and its source. The What changed panel lists economic data published in the last seven days, and the largest recent commodity moves.',
    run: async (_p, h) => { await h.go('/app'); await h.wait(1500); await h.moveTo(420, 330, 900); await h.wait(1200); await h.scroll(260, 1600); },
  },
  {
    id: 'home-more', chapter: 'Home', kind: 'app',
    narration: 'Further down are end-of-day Indian indices from EODHD, commodity benchmarks, macro indicators from FRED, and reference prices for digital assets. Status tags say whether each series is as recent as its publication schedule allows.',
    run: async (_p, h) => { await h.scroll(420, 2500); await h.wait(1200); await h.scroll(420, 2500); await h.wait(800); },
  },
  {
    id: 'search', chapter: 'Search', kind: 'app',
    narration: 'Search is one keystroke away. Control K opens the command palette, and plain words work: rupee finds the rupee to US dollar exchange rate. Search covers indices, macro series, commodities, Academy lessons and your own research. When something is not available, it says why.',
    run: async (p, h) => {
      await h.scroll(-3000, 600); await h.wait(600);
      await p.keyboard.press('Control+K'); await h.wait(900);
      await h.type('rupee', 140); await h.wait(2600);
      await p.keyboard.press('Control+A'); await h.type('gold', 160); await h.wait(3000);
      await p.keyboard.press('Control+A'); await h.type('rupee', 120); await h.wait(1400);
      await p.keyboard.press('Enter'); await h.wait(1500);
    },
  },
  {
    id: 'macro-series', chapter: 'Macro series', kind: 'app',
    narration: 'A macro series page shows the latest value, the period it refers to, when FRED first published it, and when ATLAS retrieved it. The chart has range presets, a hover read-out, drag to zoom, CSV export, a table view and full screen.',
    run: async (p, h) => {
      await h.go('/app/macro/DEXINUS'); await h.wait(1200); await h.scroll(240, 1000);
      await h.click('button.chip:text-is("1Y")'); await h.wait(900);
      const box = await p.locator('.tsc svg, svg.tsc-svg, .tsc-plot svg').first().boundingBox().catch(() => null);
      if (box) {
        await h.moveTo(box.x + box.width * 0.2, box.y + box.height * 0.5, 600);
        await h.moveTo(box.x + box.width * 0.8, box.y + box.height * 0.5, 2600);
        await h.click('button.chip:text-is("5Y")'); await h.wait(900);
        await p.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.5); await p.mouse.down();
        await h.moveTo(box.x + box.width * 0.7, box.y + box.height * 0.5, 1200); await p.mouse.up(); await h.wait(1500);
        await h.click('button.chip:text-is("Reset zoom")'); await h.wait(800);
      }
    },
  },
  {
    id: 'follow', chapter: 'Follow a series', kind: 'app',
    narration: 'Follow a series, and ATLAS posts a notice when a newer observation is stored. You are never notified about the backlog that already existed when you followed.',
    run: async (_p, h) => { await h.scroll(-600, 600); await h.wait(600); await h.click('button:has-text("Follow")'); await h.wait(3500); },
  },
  {
    id: 'explorer', chapter: 'Relationship explorer', kind: 'app',
    narration: 'The relationship explorer compares any two stored series, for example Brent crude against the NIFTY 50. Both are put on a common frequency, and their changes are correlated over a rolling window. The page states its method and limits: a correlation is not causation.',
    run: async (_p, h) => {
      await h.go('/app/macro/explorer'); await h.wait(2000);
      await h.click('button.link:has-text("Brent crude vs NIFTY 50")'); await h.wait(2500);
      await h.scroll(330, 1800); await h.wait(1500); await h.scroll(450, 2000); await h.wait(1500); await h.scroll(500, 2000);
    },
  },
  {
    id: 'commodities', chapter: 'Commodities', kind: 'app',
    narration: 'Commodities covers global benchmarks such as Brent and WTI crude, natural gas and metals, with US inventories from the Energy Information Administration. Indian futures are not shown, because exchange terms do not permit automated collection without a licence.',
    run: async (_p, h) => { await h.go('/app/commodities'); await h.wait(1500); await h.scroll(350, 2000); await h.wait(800); await h.go('/app/commodities/fred/DCOILBRENTEU'); await h.wait(1500); await h.scroll(300, 1500); },
  },
  {
    id: 'indices', chapter: 'Indian markets', kind: 'app',
    narration: 'Indian markets covers the indices that the free EODHD plan provides. Closes are end of day, and final after the evening update. ATLAS never calls them live.',
    run: async (_p, h) => { await h.go('/app/equities/INDEX/NIFTY50'); await h.wait(1500); await h.scroll(320, 2000); await h.wait(1000); },
  },
  {
    id: 'crypto', chapter: 'Digital assets', kind: 'app',
    narration: 'Digital assets uses CoinGecko reference prices, requested at a pace that stays within the free monthly allowance.',
    run: async (_p, h) => { await h.go('/app/crypto'); await h.wait(1500); await h.scroll(380, 2200); },
  },
  {
    id: 'research', chapter: 'Research hub', kind: 'app',
    narration: 'The research hub holds a workbench, research portfolios, a notebook and reports. Your research is private to your account, and search only ever returns your own.',
    run: async (_p, h) => { await h.go('/app/research-hub'); await h.wait(1800); await h.scroll(300, 1800); await h.wait(800); },
  },
  {
    id: 'academy', chapter: 'Academy and progress', kind: 'app',
    narration: 'The Academy teaches with evidence. Courses begin with a readiness check. Progress earns XP, levels and achievements for real work: lessons, quizzes, and documented research such as a correlation study in the explorer.',
    run: async (_p, h) => { await h.go('/app/academy'); await h.wait(1500); await h.scroll(300, 1500); await h.go('/app/academy/progress'); await h.wait(1500); await h.scroll(400, 2200); await h.wait(600); },
  },
  {
    id: 'settings', chapter: 'Settings', kind: 'app',
    narration: 'Settings decides which Home panels appear and in which order, whether release notices or a weekly summary arrive, the theme, and whether learning streaks are shown at all.',
    run: async (_p, h) => { await h.go('/app/settings'); await h.wait(1500); await h.hover('button[aria-label^="Move"]'); await h.wait(800); await h.scroll(420, 2200); await h.wait(800); await h.scroll(400, 1800); },
  },
  {
    id: 'data-health', chapter: 'Data sources', kind: 'app',
    narration: 'Data sources shows where each dataset comes from, how current it is, and the state of every provider connection. Rate limits are respected automatically.',
    run: async (_p, h) => { await h.go('/app/data-health'); await h.wait(1500); await h.scroll(400, 2200); await h.wait(800); await h.scroll(400, 1800); },
  },
  {
    id: 'mobile', chapter: 'On a phone', kind: 'app', viewport: { width: 390, height: 844 },
    narration: 'The same workspace adapts to a phone screen.',
    run: async (_p, h) => { await h.go('/app'); await h.wait(1200); await h.scroll(600, 2200); },
  },
  {
    id: 'outro', chapter: 'Limits', kind: 'card',
    card: { title: 'Known limits', lines: ['No individual Indian shares or company financials: no licensed source is connected', 'No gold or silver prices: no permitted free daily source', 'End-of-day and monthly data are not live prices', 'A research and learning tool, not investment advice'] },
    narration: 'Some limits are worth stating plainly. There are no individual Indian shares or company financials yet, because no licensed source is connected. Gold and silver have no permitted free source. End-of-day data is not live. ATLAS is a research and learning tool, not investment advice.',
  },
];
