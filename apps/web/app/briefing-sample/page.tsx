'use client';
import { BriefingView } from '@/components/briefing';

export default function SampleBriefing() {
  return (
    <>
      <h1>Sample post-close briefing</h1>
      <p className="mu">Published after end-of-day data passes validation (target 20:30 IST on trading days). Observed facts, calculated results and possible explanations are labelled separately. <a href="/signup">Create a free account</a> to open each figure’s evidence and drill into sectors.</p>
      <BriefingView />
    </>
  );
}
