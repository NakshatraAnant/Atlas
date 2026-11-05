// Writes artifacts/ATLAS_WALKTHROUGH_SCRIPT.md from the scene list (and the recorded timings, when present).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { SCENES } from './scenes.mjs';

const tl = existsSync('.atlas/walkthrough-work/timeline.json') ? JSON.parse(readFileSync('.atlas/walkthrough-work/timeline.json', 'utf8')) as { total: number; chapters: { s: number; e: number; label: string }[]; cards: { s: number; e: number; title: string }[] } : null;
const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
let app = 0;
const rows = SCENES.map((s) => {
  let at = '';
  if (tl) {
    if (s.kind === 'card') { const c = tl.cards[s.id === 'intro' ? 0 : 1]!; at = `${mmss(c.s)}–${mmss(c.e)}`; } else { const c = tl.chapters[app++]!; at = `${mmss(c.s)}–${mmss(c.e)}`; }
  }
  const shown = s.kind === 'card' ? `Title card: **${s.card!.title}** — ${s.card!.lines.join(' · ')}` : `Live app${s.viewport ? ` at ${s.viewport.width}×${s.viewport.height} (phone)` : ' at 1280×720'}: ${s.chapter}`;
  return `### ${s.chapter}${at ? ` (${at})` : ''}\n\n*On screen:* ${shown}\n\n*Narration:* ${s.narration}\n`;
});
writeFileSync('artifacts/ATLAS_WALKTHROUGH_SCRIPT.md', `# ATLAS walkthrough: script\n\nThe narration of artifacts/ATLAS_COMPLETE_PRODUCT_WALKTHROUGH.mp4, scene by scene. Source: \`scripts/walkthrough/scenes.mts\`. The voice is a synthetic Windows voice (Microsoft Zira Desktop), not a real person's voice.${tl ? ` Total length ${mmss(tl.total)}.` : ''}\n\n${rows.join('\n')}`);
console.log('written');
