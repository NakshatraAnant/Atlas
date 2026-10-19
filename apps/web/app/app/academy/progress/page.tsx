'use client';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Loading, Problem, useApi } from '@/components/ui';

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
}

const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export default function LearningProgress() {
  const me = useApi<Me>('/v1/academy/me');
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
      <h1>Your learning</h1>

      <section className="card next-action" aria-labelledby="na">
        <h2 id="na">Recommended next</h2>
        <p className="big">{m.recommendation.href ? <a href={m.recommendation.href}>{m.recommendation.title}</a> : m.recommendation.title}</p>
        <p className="mu">Why: {m.recommendation.reason}{m.recommendation.effort ? ` · ${m.recommendation.effort}` : ''}{m.recommendation.reward ? ` · ${m.recommendation.reward}` : ''}</p>
      </section>

      <div className="grid2">
        <section className="card" aria-labelledby="lv">
          <h2 id="lv">Level {m.xp.level}</h2>
          <div className="meter" role="progressbar" aria-valuemin={m.xp.level_start} aria-valuemax={m.xp.next_level_at} aria-valuenow={m.xp.xp} aria-label={`XP towards level ${m.xp.level + 1}`}><i style={{ width: `${pct}%` }} /></div>
          <p className="mu">{m.xp.xp} XP · {m.xp.next_level_at - m.xp.xp} XP to level {m.xp.level + 1}. XP counts learning activity; mastery (on each course page) is measured separately and can go down as well as up.</p>
        </section>
        <section className="card" aria-labelledby="st">
          <h2 id="st">Streaks</h2>
          <p><strong>{m.streak.daily.current}</strong> day{m.streak.daily.current === 1 ? '' : 's'} in a row{m.streak.daily.today_active ? ' · today counted' : ' · learn today to continue'}{m.streak.daily.rest_days_in_current ? ` · ${m.streak.daily.rest_days_in_current} rest day used` : ''}. Longest: {m.streak.daily.longest}.</p>
          <p><strong>{m.streak.weekly.current}</strong> week{m.streak.weekly.current === 1 ? '' : 's'} meeting your goal · this week {m.streak.weekly.this_week_days} of {m.streak.weekly.goal} days.</p>
          <p className="mu">A day counts when you complete a lesson or quiz, recall a concept in review, solve a game or submit a capstone. One missed day a week is treated as a rest day. Missing days never removes XP or achievements.</p>
        </section>
      </div>

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
