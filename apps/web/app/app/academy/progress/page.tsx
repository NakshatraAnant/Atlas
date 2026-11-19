'use client';
import { useApp } from '@/components/providers';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Loading, Problem, useApi } from '@/components/ui';
import { ProgressRing } from '@/components/academy-journey';
import { CountUp } from '@/components/motion';

interface Me {
  settings: { timezone: string; weekly_goal_days: number };
  xp: { level: number; xp: number; level_start: number; next_level_at: number };
  xp_rules: { kind: string; xp: number; label: string; once: string }[];
  streak: { daily: { current: number; longest: number; today_active: boolean; rest_days_in_current: number }; weekly: { current: number; this_week_days: number; goal: number } };
  calendar: { date: string; active: boolean; future: boolean; xp: number }[];
  recent: { kind: string; ref: string; xp: number; occurred_at: string; label: string }[];
  achievements: { id: string; title: string; description: string; glyph: string; requirement: string; progress: [number, number]; unlocked_at: string | null }[];
  missions: { id: string; kind: string; title: string; why: string; condition: string; effort: string; reward: string; done: boolean; href?: string; progress?: [number, number] }[];
  recommendation: { kind: string; title: string; reason: string; effort: string; reward: string; href?: string };
  notes: string[];
  rank: { rank: number; title: string; next: null | { title: string; needs_level: number; level_ok: boolean; needs_mastered: number; mastered_ok: boolean; needs_practices: { kind: string; label: string; done: boolean }[] } };
  skill_map: { id: string; title: string; objectives: number; mastered: number; practices: { kind: string; label: string; done: boolean }[]; needs_practice: { objective_id: string; statement: string }[] }[];
  research: { this_week: number; hypotheses_open: { entry_id: string; title: string; review_date: string; due: boolean }[] };
}

/** Group the calendar's days into Monday-start weeks with their XP and active days. */
function weeks(cal: { date: string; active: boolean; future: boolean; xp: number }[]) {
  const out: { start: string; xp: number; days: number }[] = [];
  for (const c of cal) {
    const d = new Date(`${c.date}T00:00:00Z`);
    const mon = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
    let w = out.find((x) => x.start === mon);
    if (!w) out.push((w = { start: mon, xp: 0, days: 0 }));
    if (!c.future) { w.xp += c.xp; if (c.active) w.days++; }
  }
  return out;
}

const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export default function LearningProgress() {
  const me = useApi<Me>('/v1/academy/me');
  const showStreak = useApp().me?.profile.display_prefs?.show_streak !== false;
  const [err, setErr] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState(false);
  if (me.loading) return <Loading lines={8} label="Loading your progress" />;
  if (me.error) return <Problem error={me.error} retry={me.reload} />;
  const m = me.data!;
  const pct = Math.round(((m.xp.xp - m.xp.level_start) / Math.max(1, m.xp.next_level_at - m.xp.level_start)) * 100);
  const unlocked = m.achievements.filter((a) => a.unlocked_at);
  const save = async (form: HTMLFormElement) => {
    setErr(null);
    setSaved(false);
    const f = new FormData(form);
    try {
      await api('/v1/academy/me/settings', { method: 'PUT', body: { timezone: String(f.get('tz')), weekly_goal_days: Number(f.get('goal')) } });
      setSaved(true);
      await me.reload();
    } catch (e) {
      setErr(e as ApiError);
    }
  };
  return (
    <div className="academy">
      <p><a href="/app/academy">← Academy</a></p>
      <h1>Your learning and research progress</h1>
      <section className="prog-hero" aria-label="Level and milestones">
        <ProgressRing value={pct / 100} size={112} label={`${pct}% of the way to level ${m.xp.level + 1}`} />
        <div className="ph-main">
          <p className="eyebrow">{m.rank.title}</p>
          <p className="ph-level">Level {m.xp.level}</p>
          <p className="mu"><strong className="ph-xp"><CountUp value={m.xp.xp} format={(v) => Math.round(v).toLocaleString('en-IN')} /></strong> XP · {m.xp.next_level_at - m.xp.xp} to level {m.xp.level + 1}</p>
        </div>
        <dl className="ph-stats">
          <div><dt>Badges</dt><dd>{unlocked.length}<span>/{m.achievements.length}</span></dd></div>
          <div><dt>Objectives mastered</dt><dd>{m.skill_map.reduce((a, s) => a + s.mastered, 0)}<span>/{m.skill_map.reduce((a, s) => a + s.objectives, 0)}</span></dd></div>
          <div><dt>Research this week</dt><dd>{m.research.this_week}</dd></div>
          {showStreak && <div><dt>Day streak</dt><dd>{m.streak.daily.current}</dd></div>}
        </dl>
      </section>
      <section className="card" aria-labelledby="wk">
        <h2 id="wk">XP by week <span className="mu">· last five weeks</span></h2>
        <div className="wk-bars">{weeks(m.calendar).map((w, i, all) => { const max = Math.max(1, ...all.map((x) => x.xp)); return (
          <div key={w.start} className="wk"><span className="wk-v">{w.xp}</span><span className="wk-bar" style={{ ['--h' as string]: `${(w.xp / max) * 100}%`, ['--i' as string]: i }} /><span className="wk-l">{day(w.start)}</span><span className="mu wk-d">{w.days} day{w.days === 1 ? '' : 's'}</span></div>
        ); })}</div>
        <p className="mu">Weeks start on Monday ({m.settings.timezone}). Explore your courses as a <a href="/app/academy/constellation">Knowledge Constellation</a>.</p>
      </section>

      <section className="card next-action" aria-labelledby="na">
        <h2 id="na">Recommended next</h2>
        <p className="big">{m.recommendation.href ? <a href={m.recommendation.href}>{m.recommendation.title}</a> : m.recommendation.title}</p>
        <p className="mu">Why: {m.recommendation.reason}{m.recommendation.effort ? ` · ${m.recommendation.effort}` : ''}{m.recommendation.reward ? ` · ${m.recommendation.reward}` : ''}</p>
      </section>

      <div className="grid2">
        <section className="card" aria-labelledby="lv">
          <h2 id="lv">{m.rank.title} <span className="mu">· level {m.xp.level}</span></h2>
          <div className="meter" role="progressbar" aria-valuemin={m.xp.level_start} aria-valuemax={m.xp.next_level_at} aria-valuenow={m.xp.xp} aria-label={`XP towards level ${m.xp.level + 1}`}><i style={{ width: `${pct}%` }} /></div>
          <p className="mu">{m.xp.xp} XP · {m.xp.next_level_at - m.xp.xp} XP to level {m.xp.level + 1}. XP counts learning activity; mastery (on each course page) is measured separately and can go down as well as up.</p>
          {m.rank.next && (
            <div>
              <p><strong>Next rank: {m.rank.next.title}</strong>. Ranks need competence as well as XP:</p>
              <ul className="mu">
                <li>{m.rank.next.level_ok ? '✓' : '○'} Level {m.rank.next.needs_level}</li>
                <li>{m.rank.next.mastered_ok ? '✓' : '○'} {m.rank.next.needs_mastered} learning objectives mastered</li>
                {m.rank.next.needs_practices.map((p) => <li key={p.kind}>{p.done ? '✓' : '○'} {p.label}</li>)}
              </ul>
            </div>
          )}
        </section>
        {showStreak ? <section className="card" aria-labelledby="st">
          <h2 id="st">Streaks</h2>
          <p><strong>{m.streak.daily.current}</strong> day{m.streak.daily.current === 1 ? '' : 's'} in a row{m.streak.daily.today_active ? ' · today counted' : ' · learn today to continue'}{m.streak.daily.rest_days_in_current ? ` · ${m.streak.daily.rest_days_in_current} rest day used` : ''}. Longest: {m.streak.daily.longest}.</p>
          <p><strong>{m.streak.weekly.current}</strong> week{m.streak.weekly.current === 1 ? '' : 's'} meeting your goal · this week {m.streak.weekly.this_week_days} of {m.streak.weekly.goal} days.</p>
          <p className="mu">A day counts when you complete a lesson or quiz, recall a concept in review, solve a game, submit a capstone or do documented research (Research hub). One missed day a week is treated as a rest day. Missing days never removes XP or achievements. You can hide streaks in <a href="/app/settings">Settings</a>.</p>
        </section> : <section className="card"><h2>Streaks</h2><p className="mu">Streaks are hidden. <a href="/app/settings">Show them in Settings</a>.</p></section>}
      </div>

      <section className="card" aria-labelledby="sk">
        <h2 id="sk">Skill map</h2>
        <p className="mu">Mastery comes from repeated correct answers on each objective; practices are research you have actually done in ATLAS. Completing courses is not a professional qualification.</p>
        {m.skill_map.map((a) => (
          <div key={a.id} className="skill-row">
            <div><strong>{a.title}</strong><div className="mu" style={{ fontSize: 12 }}>{a.mastered} of {a.objectives} objectives mastered</div></div>
            <div>
              <div className="meter" role="progressbar" aria-label={`${a.title} mastery`} aria-valuemin={0} aria-valuemax={a.objectives} aria-valuenow={a.mastered}><i style={{ width: `${a.objectives ? (a.mastered / a.objectives) * 100 : 0}%` }} /></div>
              {a.practices.length > 0 && <div className="mu" style={{ fontSize: 12 }}>{a.practices.map((p) => `${p.done ? '✓' : '○'} ${p.label}`).join(' · ')}</div>}
              {a.needs_practice.length > 0 && <div className="warn" style={{ fontSize: 12 }}>Needs practice: {a.needs_practice.map((n) => n.statement).join('; ')}</div>}
            </div>
          </div>
        ))}
      </section>

      <section className="card" aria-labelledby="rp">
        <h2 id="rp">Research in progress</h2>
        <p>{m.research.this_week} documented research activit{m.research.this_week === 1 ? 'y' : 'ies'} this week.</p>
        {m.research.hypotheses_open.length ? <ul>{m.research.hypotheses_open.map((h) => <li key={h.entry_id}><a href="/app/research-hub?tab=notebook">{h.title}</a> <span className={h.due ? 't i' : 'mu'}>{h.due ? 'review due' : `review on ${h.review_date}`}</span></li>)}</ul> : <p className="mu">No open hypotheses. <a href="/app/research-hub?tab=notebook">Record one</a> before you look at an outcome.</p>}
      </section>

      <section className="card" aria-labelledby="cal">
        <h2 id="cal">Last five weeks</h2>
        <ol className="lcal" aria-label="Learning calendar, Monday to Sunday">
          {m.calendar.map((c) => (
            <li key={c.date} className={c.future ? 'f' : c.active ? 'a' : ''} title={`${day(c.date)}: ${c.future ? 'upcoming' : c.active ? `learned · ${c.xp} XP` : 'no learning'}`}>
              <span className="sr-only">{day(c.date)}: {c.future ? 'upcoming' : c.active ? `learned, ${c.xp} XP` : 'no learning'}</span>
              <span aria-hidden="true">{c.active ? '●' : ''}</span>
            </li>
          ))}
        </ol>
        <p className="mu">Days are counted in {m.settings.timezone}.</p>
      </section>

      <section aria-labelledby="ms">
        <h2 id="ms">Missions</h2>
        <ul className="missions">
          {m.missions.map((x) => (
            <li key={x.id} className={`card${x.done ? ' done' : ''}`}>
              <h3>{x.href ? <a href={x.href}>{x.title}</a> : x.title} {x.done && <span className="t o">Done</span>}</h3>
              <p>{x.condition}</p>
              <p className="mu">Why: {x.why} · Effort: {x.effort} · Reward: {x.reward}{x.progress ? ` · ${x.progress[0]}/${x.progress[1]}` : ''}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="ac">
        <h2 id="ac">Achievements <span className="mu">· {unlocked.length} of {m.achievements.length}</span></h2>
        <ul className="badges">
          {m.achievements.map((a) => (
            <li key={a.id} className={a.unlocked_at ? 'on' : ''}>
              <span className="glyph" aria-hidden="true">{a.glyph}</span>
              <strong>{a.title}</strong>
              <span>{a.description}</span>
              <span className="mu">{a.unlocked_at ? `Unlocked ${new Date(a.unlocked_at).toLocaleDateString('en-IN')}` : `Progress ${a.progress[0]}/${a.progress[1]}`} · Evidence: {a.requirement}</span>
            </li>
          ))}
        </ul>
      </section>

      <div className="grid2">
        <section className="card" aria-labelledby="xr">
          <h2 id="xr">How XP is earned</h2>
          <div className="wrap"><table><caption className="sr-only">XP rules</caption><thead><tr><th scope="col">Action</th><th scope="col">XP</th><th scope="col">At most</th></tr></thead>
            <tbody>{m.xp_rules.map((r) => <tr key={r.kind}><td>{r.label}</td><td>{r.xp}</td><td>once {r.once}</td></tr>)}</tbody></table></div>
        </section>
        <section className="card" aria-labelledby="rc">
          <h2 id="rc">Recent XP</h2>
          {m.recent.length ? <ul>{m.recent.map((e) => <li key={`${e.kind}-${e.ref}`}>+{e.xp} · {e.label} <span className="mu">{new Date(e.occurred_at).toLocaleDateString('en-IN')}</span></li>)}</ul> : <p className="mu">Nothing yet. Your first lesson earns {m.xp_rules.find((r) => r.kind === 'lesson_completed')?.xp} XP.</p>}
        </section>
      </div>

      <section className="card" aria-labelledby="se">
        <h2 id="se">Settings</h2>
        <form onSubmit={(e) => { e.preventDefault(); void save(e.currentTarget); }} className="row">
          <label className="field">Timezone (for streak days)<input name="tz" defaultValue={m.settings.timezone} maxLength={64} /></label>
          <label className="field">Weekly goal (days)<input name="goal" type="number" min={1} max={7} defaultValue={m.settings.weekly_goal_days} /></label>
          <button className="btn">Save</button>
        </form>
        {saved && <p className="okbox" role="status">Saved.</p>}
        <Problem error={err} />
        <p className="mu">No reminders are sent. Leaderboards are not offered: there is no opt-in community yet, and ATLAS does not invent participants.</p>
      </section>
      <ul className="mu">{m.notes.map((n) => <li key={n}>{n}</li>)}</ul>
    </div>
  );
}
