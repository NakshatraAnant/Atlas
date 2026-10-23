'use client';
import { BriefingView } from '@/components/briefing';
import { useDemoMode } from '@/components/shell';
import { Loading } from '@/components/ui';

export default function SampleBriefing() {
  const demo = useDemoMode();
  if (demo === null) return <Loading lines={3} />;
  // The sample briefing is built from the fictional development companies; it is not shown in real-data mode.
  if (!demo) return (
    <>
      <h1>Sample briefing</h1>
      <p>The sample briefing uses fictional practice companies and is not available in this installation, which shows only real, sourced data. Sign in to see the Indian indices, commodities and macro data ATLAS stores.</p>
    </>
  );
  return (
    <>
      <h1>Sample post-close briefing</h1>
      <p className="mu">Published after end-of-day data passes validation (target 20:30 IST on trading days). Observed facts, calculated results and possible explanations are labelled separately. <a href="/signup">Create a free account</a> to open each figure’s evidence and drill into sectors.</p>
      <BriefingView />
    </>
  );
}
