'use client';
import { use } from 'react';
import { BriefingView } from '@/components/briefing';

export default function BriefingDate({ params }: { params: Promise<{ date: string }> }) {
  const { date } = use(params);
  return (
    <>
      <p><a href="/app/briefings">← Briefing archive</a></p>
      <BriefingView date={date} />
      <p><a className="btn s" href={`/app/assistant?briefing_date=${date}&q=${encodeURIComponent('Explain what moved the market in this briefing')}`}>Ask about this briefing</a></p>
    </>
  );
}
