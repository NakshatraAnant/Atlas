'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { FollowButton } from './follow-button';
import { useApp } from './providers';

// First-run welcome on Home (real-data mode): three short steps that point at the features new users miss.
// It is shown until dismissed (display_prefs.tour_done), and Settings can bring it back.
export function WelcomeTour() {
  const { me, refresh } = useApp();
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!me || hidden || me.profile.display_prefs?.tour_done) return null;
  // Hide at once; the preference is saved in the background (and the card returns if saving fails).
  const done = async () => {
    setHidden(true);
    try {
      await api('/v1/me', { method: 'PATCH', body: { display_prefs: { tour_done: true } } });
      void refresh();
    } catch {
      setHidden(false);
      setError('Could not save that. Try again.');
    }
  };
  const openSearch = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
  return (
    <section className="card welcome-tour" aria-labelledby="h-wt">
      <h2 id="h-wt">Welcome to ATLAS: three quick steps</h2>
      <ol className="wt-steps">
        <li>
          <strong>Choose what Home shows.</strong> <span className="mu">Pick your markets and the panels you want, in your order.</span>{' '}
          <a href="/app/settings">Open Settings</a>
        </li>
        <li>
          <strong>Follow two series.</strong> <span className="mu">You get a notice when a newer observation is stored.</span>
          <span className="wt-follows">
            <span>US 10-year Treasury yield <FollowButton seriesKey="macro:DGS10" label="US 10-year Treasury yield" /></span>
            <span>Brent crude oil <FollowButton seriesKey="commodity:fred:DCOILBRENTEU" label="Brent crude oil" /></span>
          </span>
        </li>
        <li>
          <strong>Search anything.</strong> <span className="mu">Press Ctrl+K (⌘K on a Mac) anywhere, then type plain words such as “rupee” or “brent”.</span>{' '}
          <button className="chip" onClick={openSearch}>Try search</button>
        </li>
      </ol>
      <p><button className="btn" onClick={done}>Done, hide this</button> <span className="mu">You can show it again from Settings.</span>{error && <span className="warn"> {error}</span>}</p>
    </section>
  );
}
