'use client';
import { api } from '@/lib/api';
import { Empty, Loading, Problem, useApi } from '@/components/ui';
import { dateOrDash } from '@/lib/format';

export default function Notifications() {
  const n = useApi<{ notifications: { notification_id: string; kind: string; title: string; body: string | null; href: string | null; read_at: string | null; created_at: string }[] }>('/v1/notifications');
  if (n.loading) return <Loading />;
  if (n.error) return <Problem error={n.error} retry={n.reload} />;
  const read = async (id: string) => { await api(`/v1/notifications/${id}/read`, { body: {} }).catch(() => undefined); n.reload(); };
  return (
    <>
      <h1>Notices</h1>
      {n.data!.notifications.length === 0 ? <Empty>No notices. Billing changes, data corrections and alert digests appear here.</Empty> : (
        <ul className="card">{n.data!.notifications.map((x) => (
          <li key={x.notification_id} style={{ marginBottom: 8, fontWeight: x.read_at ? 400 : 600 }}>
            {x.href ? <a href={x.href} onClick={() => read(x.notification_id)}>{x.title}</a> : x.title} <span className="mu">{dateOrDash(x.created_at)}</span>
            {x.body && <div className="mu" style={{ fontWeight: 400 }}>{x.body}</div>}
            {!x.read_at && <button className="link" onClick={() => read(x.notification_id)}>Mark as read</button>}
          </li>
        ))}</ul>
      )}
    </>
  );
}
