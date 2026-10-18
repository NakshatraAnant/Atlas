'use client';
import { use, useEffect, useState } from 'react';
import { api, download } from '@/lib/api';
import { useApp } from '@/components/providers';
import { Loading, Problem, Synthetic, Tabs, useApi } from '@/components/ui';
import { dateOrDash } from '@/lib/format';
import { Disclosures, Financials, Overview, Ownership, Peers, Quality, Ratios, Technical, Valuation, type Company } from './tabs';

const TABS: [string, string][] = [['overview', 'Overview'], ['financials', 'Financials'], ['ratios', 'Ratios'], ['quality', 'Quality flags'], ['valuation', 'Valuation'], ['ownership', 'Ownership'], ['technical', 'Price & technicals'], ['disclosures', 'Disclosures'], ['peers', 'Peers']];

export default function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { toast, me } = useApp();
  const [tab, setTab] = useState('overview');
  useEffect(() => {
    const t = new URLSearchParams(location.search).get('tab');
    if (t && TABS.some((x) => x[0] === t)) setTab(t);
  }, []);
  const change = (t: string) => {
    setTab(t);
    const u = new URL(location.href);
    u.searchParams.set('tab', t);
    history.replaceState(null, '', u);
    void api('/v1/analytics/events', { body: { name: 'company_viewed', props: { company_id: id, section: t } } }).catch(() => undefined);
  };
  const c = useApi<Company>(`/v1/companies/${id}`);
  if (c.loading) return <Loading lines={8} label="Loading company" />;
  if (c.error) return <Problem error={c.error} retry={c.reload} />;
  const d = c.data!;
  const co = d.company;
  const limited = !d.access.full;
  const addToWatchlist = async () => {
    try {
      const lists = await api<{ watchlists: { watchlist_id: string; name: string }[] }>('/v1/watchlists');
      const w = lists.watchlists[0] ?? (await api<{ watchlist_id: string; name: string }>('/v1/watchlists', { body: { name: 'My watchlist' } }));
      await api(`/v1/watchlists/${w.watchlist_id}/items`, { body: { company_id: id, source_surface: 'company' } });
      toast(`Added to ${w.name}`);
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const saveWorkspace = async () => {
    try {
      await api('/v1/workspaces', { body: { name: `${co.short_name} — ${tab}`, company_id: id, state: { tab }, figures: [] } });
      toast('Workspace saved with today’s data date');
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const exportPdf = async () => {
    try {
      await download(`/v1/companies/${id}/export`, {}, `atlas-${co.short_name.replace(/\W+/g, '-').toLowerCase()}.pdf`);
    } catch (e) {
      toast((e as Error).message);
    }
  };
  return (
    <>
      <p><a href="/app/companies">← Companies</a></p>
      <header>
        <h1 style={{ marginBottom: 4 }}>{co.short_name} {co.is_synthetic && <Synthetic />}</h1>
        <p className="mu">{co.legal_name} · {[co.nse_symbol && `NSE ${co.nse_symbol}`, co.bse_code && `BSE ${co.bse_code}`, co.isin].filter(Boolean).join(' · ')} · {co.sector} / {co.industry}
          {co.status !== 'listed' && <strong> · {co.status}{co.delisted_on ? ` on ${dateOrDash(co.delisted_on)}` : ''}</strong>}
          {co.former_names.length > 0 && <> · formerly {co.former_names.join(', ')}</>}</p>
        <div className="row">
          <button className="btn" onClick={addToWatchlist}>Add to watchlist</button>
          <a className="btn s" href={`/app/assistant?company_id=${id}`}>Ask about {co.short_name}</a>
          <a className="btn s" href={`/app/research?tab=notes&new=company:${id}`}>Add a note</a>
          <button className="btn s" onClick={saveWorkspace}>Save workspace</button>
          <button className="btn s" onClick={exportPdf} title={me?.entitlements.pdf_exports_per_month === 0 ? 'PDF export is part of Plus and Pro' : undefined}>Export PDF</button>
        </div>
      </header>
      {limited && <div className="warn">You have used {d.access.used} of {d.access.limit} full company profiles this month. This view shows the overview only. <a href="/pricing">Compare plans</a></div>}
      {d.since_last_visit && <div className="okbox">Since your last visit ({dateOrDash(d.since_last_visit.last_visit_at)}): {d.since_last_visit.changes.map((i) => i.title).join('; ') || 'no material changes'}.</div>}
      <Tabs tabs={limited ? TABS.slice(0, 1) : TABS} active={tab} onChange={change} />
      <div role="tabpanel">
        {tab === 'overview' && <Overview id={id} c={d} />}
        {!limited && tab === 'financials' && <Financials id={id} />}
        {!limited && tab === 'ratios' && <Ratios id={id} />}
        {!limited && tab === 'quality' && <Quality id={id} />}
        {!limited && tab === 'valuation' && <Valuation id={id} />}
        {!limited && tab === 'ownership' && <Ownership id={id} />}
        {!limited && tab === 'technical' && <Technical id={id} />}
        {!limited && tab === 'disclosures' && <Disclosures id={id} />}
        {!limited && tab === 'peers' && <Peers id={id} />}
      </div>
    </>
  );
}
