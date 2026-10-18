'use client';
import { BriefingView } from '@/components/briefing';
import { useApp } from '@/components/providers';
import { Empty, Loading, Problem, useApi } from '@/components/ui';
import { dateOrDash, formatDate } from '@/lib/format';

interface Change { company_id: string; short_name: string; kind: string; title: string; at: string; href?: string }
interface Recent { kind: string; ref_id: string; label: string; at: string }
interface CalEvent { event_date: string; kind: string; title: string; status: string; company_id: string | null; source: string }

export default function Home() {
  const { me } = useApp();
  const changed = useApi<{ items: Change[]; empty_state?: string }>('/v1/home/what-changed');
  const recent = useApi<{ items: Recent[] }>('/v1/home/recent');
  const cal = useApi<{ events: CalEvent[] }>('/v1/market/calendar');
  const lists = useApi<{ watchlists: { watchlist_id: string; name: string; items?: { company_id: string; short_name: string }[] }[] }>('/v1/watchlists');
  const hrefFor = (r: Recent) => (r.kind === 'company_view' ? `/app/companies/${r.ref_id}` : r.kind === 'backtest' ? `/app/lab/runs/${r.ref_id}` : r.kind === 'screen' ? '/app/screener' : '/app/research');
  return (
    <>
      <h1>Good {new Date().getHours() < 12 ? 'morning' : 'evening'}{me?.profile.display_name ? `, ${me.profile.display_name}` : ''}</h1>
      {me && !me.profile.onboarding_completed_at && <p className="warn">Finish setting up: <a href="/onboarding">two quick questions</a> tailor explanations to you.</p>}
      <div className="grid2">
        <div>
          <BriefingView compact />
          <p><a href="/app/market">Full market view</a> · <a href="/app/briefings">Briefing archive</a></p>
        </div>
        <div>
          <section className="card" aria-labelledby="wc">
            <h2 id="wc">What changed in your companies</h2>
            {changed.loading ? <Loading /> : changed.error ? <Problem error={changed.error} retry={changed.reload} /> : changed.data!.items.length === 0 ? <Empty>{changed.data!.empty_state ?? 'Nothing new since your last visit.'}</Empty> : (
              <ul>{changed.data!.items.map((c, i) => <li key={i}><a href={c.href ?? `/app/companies/${c.company_id}`}>{c.short_name}</a>: {c.title} <span className="mu">{dateOrDash(c.at)}</span></li>)}</ul>
            )}
          </section>
          <section className="card" aria-labelledby="wl">
            <h2 id="wl">Watchlists</h2>
            {lists.loading ? <Loading lines={2} /> : lists.error ? <Problem error={lists.error} /> : lists.data!.watchlists.length === 0 ? <Empty>No watchlists yet. Open a company and choose “Add to watchlist”.</Empty> : (
              <ul>{lists.data!.watchlists.map((w) => <li key={w.watchlist_id}><a href={`/app/research?tab=watchlists#${w.watchlist_id}`}>{w.name}</a> <span className="mu">{w.items?.length ?? 0} companies</span></li>)}</ul>
            )}
          </section>
          <section className="card" aria-labelledby="rc">
            <h2 id="rc">Pick up where you left off</h2>
            {recent.loading ? <Loading lines={2} /> : recent.data?.items.length ? <ul>{recent.data.items.slice(0, 8).map((r, i) => <li key={i}><a href={hrefFor(r)}>{r.label}</a> <span className="mu">{dateOrDash(r.at)}</span></li>)}</ul> : <Empty>Your recent companies, screens and backtests appear here.</Empty>}
          </section>
          <section className="card" aria-labelledby="cl">
            <h2 id="cl">Upcoming calendar</h2>
            {cal.loading ? <Loading lines={2} /> : cal.error ? <Problem error={cal.error} /> : cal.data!.events.length === 0 ? <Empty>No scheduled events in the next two weeks.</Empty> : (
              <div className="wrap"><table><caption className="sr-only">Upcoming events</caption><thead><tr><th scope="col">Date</th><th scope="col">Event</th><th scope="col">Status</th></tr></thead>
                <tbody>{cal.data!.events.slice(0, 10).map((e, i) => <tr key={i}><td>{formatDate(e.event_date)}</td><td>{e.company_id ? <a href={`/app/companies/${e.company_id}`}>{e.title}</a> : e.title}</td><td>{e.status}</td></tr>)}</tbody></table></div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
