'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { useApi, Loading } from './ui';
import { useApp } from './providers';
import { DEFAULT_PANELS } from '@/lib/home-panels';
import { WelcomeTour } from './welcome-tour';
import { CountUp, readRecent, useMode } from './motion';

// Home in real-data mode: a market snapshot built only from stored, sourced observations. Every figure
// shows the date it refers to and its source; a panel without data says so instead of showing a number.
// Which panels appear, and in which order, is the user's choice (Settings).

const pct = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%`);
const cls = (v: number | null | undefined) => (v === null || v === undefined ? '' : v > 0 ? 'up' : v < 0 ? 'dn' : '');
const fmt = (v: number | null | undefined, max = 2) => (v === null || v === undefined ? '—' : v.toLocaleString('en-IN', { maximumFractionDigits: max }));
const FRESH: Record<string, [string, string]> = { fresh: ['o', 'current'], current: ['o', 'current'], delayed: ['i', 'delayed'], stale: ['r', 'stale'], unavailable: ['m', 'no data'], provider_error: ['r', 'update failed'], no_data: ['m', 'no data'] };
const Tag = ({ s }: { s: string }) => <span className={`t ${FRESH[s]?.[0] ?? 'm'}`}>{FRESH[s]?.[1] ?? s}</span>;

function Tile({ k, v, s, sub, state, href, n, f }: { k: string; v: string; s?: string; sub?: string; state?: string; href?: string; n?: number | null; f?: (v: number) => string }) {
  return (
    <div className="cx-kpi">
      <span className="k">{href ? <a href={href}>{k}</a> : k}</span>
      <span className="v">{n !== undefined && n !== null && f ? <CountUp value={n} format={f} /> : v}</span>
      {s && <span className={`s ${s.startsWith('+') ? 'up' : s.startsWith('-') ? 'dn' : ''}`}>{s}</span>}
      {sub && <span className="s">{sub} {state && <Tag s={state} />}</span>}
    </div>
  );
}

interface Attention {
  releases: { title: string; href: string; period: string; value: number; units: string | null; published: string }[];
  moves: { title: string; href: string; date: string; value: number; unit: string; change: number }[];
  following: { key: string; title: string; href: string; latest: string | null; value: number | null; unit: string | null }[];
}

export function RealHome({ name }: { name?: string | null }) {
  const { me } = useApp();
  const prefs = me?.profile.display_prefs ?? {};
  const order = prefs.home_panels ?? DEFAULT_PANELS;
  const showStreak = prefs.show_streak !== false;
  const on = (id: string) => order.includes(id);
  const eq = useApi<{ indices: { symbol: string; name: string | null; exchange: string; last_close: number | null; last_date: string | null; returns: Record<string, number | null>; behind: number | null }[]; empty_reason: string | null }>(on('indices') ? '/v1/equity/market' : null);
  const cm = useApi<{ categories: { series: { series_id: string; name: string; unit: string; source_id: string; source_series: string; last: number | null; last_date: string | null; change: { m1: number | null } | null; freshness: { state: string } }[] }[] }>(on('commodities') ? '/v1/commodities' : null);
  const mc = useApi<{ configured: boolean; items: { series_id: string; title: string; units: string | null; latest: { d: string; v: number } | null; freshness: { state: string } }[] }>(on('macro') ? '/v1/macro' : null);
  const cr = useApi<{ majors: { canonical_key: string; name: string; symbol: string; price: number; change_24h_pct: number | null; provider_updated_at: string | null }[]; attribution?: string }>(on('crypto') ? '/v1/crypto/overview' : null);
  const attn = useApi<Attention>(on('attention') || on('following') ? '/v1/home/attention' : null);
  const learn = useApi<{ xp: { level: number; xp: number }; streak: { daily: { current: number } }; recommendation: { title: string; reason: string; href?: string }; missions?: { id: string; kind: string; title: string; effort: string; reward: string; done: boolean; href?: string }[] }>(on('learning') ? '/v1/academy/me' : null);
  const commodities = cm.data?.categories.flatMap((c) => c.series).filter((x) => ['fred:DCOILBRENTEU', 'fred:DCOILWTICO', 'fred:DHHNGSP', 'fred:PCOPPUSDM'].includes(x.series_id)) ?? [];
  const macro = mc.data?.items.filter((x) => ['DGS10', 'DFF', 'DEXINUS', 'CPIAUCSL', 'UNRATE', 'T10Y2Y'].includes(x.series_id)) ?? [];

  const panels: Record<string, () => ReactNode> = {
    attention: () => (
      <section className="card" aria-labelledby="h-at" key="attention">
        <h2 id="h-at">What changed</h2>
        {attn.loading && !attn.data ? <Loading lines={3} /> : attn.data ? (
          <div className="grid2">
            <div>
              <h3>New data releases <span className="mu">· last 7 days</span></h3>
              {attn.data.releases.length ? <ul className="attn-list">{attn.data.releases.map((r) => <li key={r.href}><a href={r.href}>{r.title}</a><span className="mu">{fmt(r.value, 3)} {r.units ?? ''} · for {r.period} · published {r.published}</span></li>)}</ul> : <p className="mu">No monthly or slower series published new data in the last 7 days.</p>}
            </div>
            <div>
              <h3>Largest commodity moves <span className="mu">· about one month</span></h3>
              {attn.data.moves.length ? <ul className="attn-list">{attn.data.moves.map((m) => <li key={m.href}><a href={m.href}>{m.title.replace(/ \(.*\)$/, '')}</a><span><span className={cls(m.change)}>{pct(m.change)}</span> <span className="mu">to {fmt(m.value)}{m.unit ? ` ${m.unit}` : ''} on {m.date}</span></span></li>)}</ul> : <p className="mu">No recent daily commodity observations.</p>}
            </div>
          </div>
        ) : <p className="mu">Recent changes could not be loaded.</p>}
      </section>
    ),
    following: () => (
      <section className="card" aria-labelledby="h-fl" key="following">
        <h2 id="h-fl">Followed series <span className="mu">· <a href="/app/settings">manage</a></span></h2>
        {attn.loading && !attn.data ? <Loading lines={1} /> : attn.data?.following.length ? (
          <div className="cx-kpis">{attn.data.following.map((f) => <Tile key={f.key} k={f.title.length > 40 ? `${f.title.slice(0, 38)}…` : f.title} href={f.href} v={fmt(f.value, 3)} sub={`${f.unit ?? ''}${f.latest ? `, ${f.latest}` : ''}`} />)}</div>
        ) : <p className="mu">Follow a <a href="/app/macro">macro</a> or <a href="/app/commodities">commodity</a> series to see it here and get a notice when new data arrives.</p>}
      </section>
    ),
    indices: () => (
      <section className="card" aria-labelledby="h-in" key="indices">
        <h2 id="h-in"><a href="/app/equities">Indian indices</a> <span className="mu">· end of day, EODHD</span></h2>
        {eq.loading && !eq.data ? <Loading lines={2} /> : eq.data?.indices.length ? (
          <div className="cx-kpis">{eq.data.indices.map((i) => <Tile key={i.symbol} k={i.name ?? i.symbol} href={`/app/equities/INDEX/${i.symbol}`} v={fmt(i.last_close)} n={i.last_close} f={(x) => fmt(x)} s={pct(i.returns.d1, 2)} sub={`close on ${i.last_date}`} state={i.behind === 0 ? 'current' : i.behind === null ? 'no_data' : 'delayed'} />)}</div>
        ) : <p className="mu">{eq.data?.empty_reason ?? 'No index data stored yet.'}</p>}
      </section>
    ),
    commodities: () => (
      <section className="card" aria-labelledby="h-cm" key="commodities">
        <h2 id="h-cm"><a href="/app/commodities">Commodities</a> <span className="mu">· benchmark prices (USD)</span></h2>
        {cm.loading && !cm.data ? <Loading lines={2} /> : commodities.length ? (
          <div className="cx-kpis">{commodities.map((c) => <Tile key={c.series_id} k={c.name.replace(/ \(.*\)$/, '')} href={`/app/commodities/${c.source_id}/${c.source_series}`} v={fmt(c.last)} s={pct(c.change?.m1)} sub={`${c.unit}, ${c.last_date ?? '—'}`} state={c.freshness.state} />)}</div>
        ) : <p className="mu">Commodity series are not imported yet.</p>}
      </section>
    ),
    macro: () => (
      <section className="card" aria-labelledby="h-mc" key="macro">
        <h2 id="h-mc"><a href="/app/macro">Macro</a> <span className="mu">· FRED · <a href="/app/macro/explorer">compare two series</a></span></h2>
        {mc.loading && !mc.data ? <Loading lines={2} /> : !mc.data?.configured ? <p className="mu">Macro data is not connected.</p> : macro.some((m) => m.latest) ? (
          <div className="cx-kpis">{macro.map((m) => <Tile key={m.series_id} k={m.title.length > 42 ? m.series_id : m.title} href={`/app/macro/${m.series_id}`} v={m.latest ? fmt(m.latest.v, 3) : '—'} sub={`${m.units ?? ''}${m.latest ? `, ${m.latest.d}` : ''}`} state={m.freshness.state} />)}</div>
        ) : <p className="mu">Macro series are being imported.</p>}
      </section>
    ),
    crypto: () => (
      <section className="card" aria-labelledby="h-cr" key="crypto">
        <h2 id="h-cr"><a href="/app/crypto">Digital assets</a> <span className="mu">· {cr.data?.attribution ?? 'CoinGecko reference prices'}</span></h2>
        {cr.loading && !cr.data ? <Loading lines={2} /> : cr.data?.majors.length ? (
          <div className="cx-kpis">{cr.data.majors.slice(0, 6).map((a) => <Tile key={a.canonical_key} k={`${a.name} (${a.symbol})`} href={`/app/crypto/assets/${a.canonical_key}`} v={`$${fmt(a.price)}`} s={a.change_24h_pct === null ? undefined : `${a.change_24h_pct >= 0 ? '+' : ''}${a.change_24h_pct.toFixed(2)}% 24h`} sub={a.provider_updated_at ? `as of ${new Date(a.provider_updated_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })} IST` : ''} />)}</div>
        ) : <p className="mu">No crypto snapshot stored yet.</p>}
      </section>
    ),
    learning: () => (
      <section className="card" aria-labelledby="h-le" key="learning">
        <h2 id="h-le"><a href="/app/academy">Learning</a></h2>
        {learn.loading && !learn.data ? <Loading lines={1} /> : learn.data ? (
          <p>Level {learn.data.xp.level} · {learn.data.xp.xp} XP{showStreak ? ` · ${learn.data.streak.daily.current}-day streak` : ''}. Next: {learn.data.recommendation.href ? <a href={learn.data.recommendation.href}>{learn.data.recommendation.title}</a> : learn.data.recommendation.title} <span className="mu">· {learn.data.recommendation.reason}</span></p>
        ) : <p className="mu">Start with the <a href="/app/academy">Academy</a>.</p>}
      </section>
    ),
  };

  // One clear next step, chosen from what the person said they came for and what they have done.
  const goal = prefs.goal;
  const follows = attn.data?.following.length ?? null;
  const rec = learn.data?.recommendation;
  const next: { eyebrow: string; title: string; text: string; href: string; cta: string } | null =
    goal === 'learn' && rec ? { eyebrow: 'Continue learning', title: rec.title, text: rec.reason, href: rec.href ?? '/app/academy', cta: 'Continue' }
    : goal === 'research' ? { eyebrow: 'Your next step', title: 'Test an idea in the Research Studio', text: 'Build a hypothetical portfolio or run an out-of-sample backtest on stored data.', href: '/app/research-hub', cta: 'Open the Research Studio' }
    : follows === 0 ? { eyebrow: 'Your next step', title: 'Follow a series to get notices', text: 'Pick something you care about. ATLAS tells you when a newer observation is stored.', href: '/app/macro', cta: 'Choose a series' }
    : rec ? { eyebrow: 'Keep learning', title: rec.title, text: rec.reason, href: rec.href ?? '/app/academy', cta: 'Start' }
    : null;

  // Command centre extras: today's mission, saved research and what was opened recently (this device).
  const mode = useMode();
  const reports = useApi<{ rows: { report_id: string; title: string }[] }>('/v1/research/reports');
  const ports = useApi<{ rows: { portfolio_id: string; name: string; holdings: number }[] }>('/v1/research/portfolios');
  const [recent, setRecent] = useState<{ href: string; label: string }[]>([]);
  const [tools, setTools] = useState<{ href: string; label: string }[]>([]);
  useEffect(() => { setRecent(readRecent('atlas-recent')); setTools(readRecent('atlas-tools')); }, []);
  const firstPort = ports.data?.rows[0];
  const pa = useApi<{ result: null | { total_return: number; max_drawdown: number; ratios: { vol?: number } }; reason?: string }>(firstPort ? `/v1/research/portfolios/${firstPort.portfolio_id}/analysis?range=1y` : null, [firstPort?.portfolio_id]);
  const nb = useApi<{ reviews_due: { entry_id: string; title: string; review_date: string }[] }>('/v1/research/notebook');
  const mission = learn.data?.missions?.find((m) => m.kind === 'research' && !m.done) ?? learn.data?.missions?.find((m) => !m.done) ?? null;

  // Progressive disclosure: the first three panels, then the rest on request (remembered on this device).
  const [more, setMore] = useState(false);
  useEffect(() => { try { setMore(localStorage.getItem('atlas-home-more') === '1'); } catch { /* storage off */ } }, []);
  const toggleMore = () => { const v = !more; setMore(v); try { localStorage.setItem('atlas-home-more', v ? '1' : '0'); } catch { /* storage off */ } };
  const first = order.slice(0, 3);
  const rest = order.slice(3);

  return (
    <>
      <div className="home-panel-hd">
        <h1>Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}{name ? `, ${name}` : ''}</h1>
        <a href="/app/settings" className="mu">Customise</a>
      </div>
      <p className="mu home-sub">Stored observations from named sources, each with the date it refers to. Not live prices.</p>
      <WelcomeTour />
      {next && prefs.tour_done && (
        <a className="next-step" href={next.href}>
          <span className="ns-eyebrow">{next.eyebrow}</span>
          <span className="ns-title">{next.title}</span>
          <span className="ns-text">{next.text}</span>
          <span className="btn btn-cta ns-cta">{next.cta} <span aria-hidden="true">→</span></span>
        </a>
      )}
      {mode === 'explore' && (
        <a className="explore-banner" href="/app/universe">
          <span className="eb-orb" aria-hidden="true" />
          <span><strong>Enter the ATLAS Universe</strong><span className="mu">A 3D globe of everything ATLAS stores, region by region.</span></span>
          <span className="eb-go" aria-hidden="true">→</span>
        </a>
      )}
      <div className="cmd-row">
        <section className="card cmd" aria-labelledby="cmd-m">
          <h2 id="cmd-m">Today&rsquo;s mission</h2>
          {learn.loading && !learn.data ? <Loading lines={2} /> : mission ? (
            <><p className="cmd-title">{mission.title}</p><p className="mu">{mission.effort} · {mission.reward}</p><p><a className="btn s" href={mission.href ?? '/app/academy'}>Start</a></p></>
          ) : <p className="mu">All of today&rsquo;s missions are done. <a href="/app/academy/progress">See your progress</a></p>}
        </section>
        <section className="card cmd" aria-labelledby="cmd-s">
          <h2 id="cmd-s">Saved research</h2>
          {(reports.loading || ports.loading) && !reports.data ? <Loading lines={2} /> : (reports.data?.rows.length || ports.data?.rows.length) ? (
            <ul className="cmd-list">
              {firstPort && pa.data?.result && (
                <li className="cmd-port"><a href="/app/research-hub?tab=portfolios">{firstPort.name}</a>
                  <span className="cmd-kpis"><span className={pa.data.result.total_return >= 0 ? 'up' : 'dn'}>{pct(pa.data.result.total_return)}</span><span className="mu">return</span><span className="dn">{pct(pa.data.result.max_drawdown)}</span><span className="mu">max drawdown</span>{pa.data.result.ratios.vol !== undefined && <><span>{(pa.data.result.ratios.vol * 100).toFixed(0)}%</span><span className="mu">volatility</span></>}</span>
                  <span className="mu">Hypothetical, last year, on stored prices</span></li>
              )}
              {ports.data?.rows.slice(firstPort && pa.data?.result ? 1 : 0, 2).map((p) => <li key={p.portfolio_id}><a href="/app/research-hub?tab=portfolios">{p.name}</a><span className="mu"> · hypothetical portfolio, {p.holdings} holdings</span></li>)}
              {reports.data?.rows.slice(0, 2).map((r) => <li key={r.report_id}><a href="/app/research-hub?tab=reports">{r.title}</a><span className="mu"> · report</span></li>)}
            </ul>
          ) : <p className="mu">Nothing saved yet. <a href="/app/research-hub?tab=portfolios">Build a hypothetical portfolio</a> or <a href="/app/research-hub?tab=reports">write a report</a>.</p>}
        </section>
        <section className="card cmd" aria-labelledby="cmd-u">
          <h2 id="cmd-u">Research updates</h2>
          {nb.loading && !nb.data ? <Loading lines={2} /> : (
            <ul className="cmd-list">
              {nb.data?.reviews_due.slice(0, 3).map((r) => <li key={r.entry_id}><a href="/app/research-hub?tab=notebook">{r.title}</a><span className="t i"> review due</span></li>)}
              {attn.data?.releases.slice(0, nb.data?.reviews_due.length ? 1 : 3).map((r) => <li key={r.href}><a href={r.href}>{r.title.length > 48 ? `${r.title.slice(0, 46)}…` : r.title}</a><span className="mu"> · published {r.published}</span></li>)}
              {!nb.data?.reviews_due.length && !attn.data?.releases.length && <li className="mu">No reviews due and no new releases this week.</li>}
            </ul>
          )}
        </section>
        <section className="card cmd" aria-labelledby="cmd-r">
          <h2 id="cmd-r">Jump back in</h2>
          {recent.length || tools.length ? (
            <ul className="cmd-list">
              {recent.slice(0, 3).map((r) => <li key={r.href}><a href={r.href}>{r.label}</a></li>)}
              {tools.slice(0, 2).map((r) => <li key={r.href}><a href={r.href}>{r.label}</a><span className="mu"> · tool</span></li>)}
            </ul>
          ) : <p className="mu">Pages and tools you open appear here (kept on this device). Try <a href="/app/universe">the Universe</a> or <a href="/app/network">the Intelligence Network</a>.</p>}
        </section>
      </div>
      {first.map((id) => panels[id]?.())}
      {rest.length > 0 && (
        <>
          <div className={`home-more${more ? ' open' : ''}`}>{more && rest.map((id) => panels[id]?.())}</div>
          <p className="home-more-btn"><button className="btn s" aria-expanded={more} onClick={toggleMore}>{more ? 'Show less' : `Show ${rest.length} more panel${rest.length === 1 ? '' : 's'}`}</button></p>
        </>
      )}
      {!order.length && <p className="mu">Every Home panel is hidden. <a href="/app/settings">Choose panels in Settings</a>.</p>}
    </>
  );
}
