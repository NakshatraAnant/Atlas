import { buildFixture } from './fixture.js';

export default async function setup(): Promise<void> {
  const t = Date.now();
  await buildFixture();
  process.stdout.write(`[atlas] fixture ready in ${Math.round((Date.now() - t) / 1000)} s\n`);
}
