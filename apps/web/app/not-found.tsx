import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Page not found' };

export default function NotFound() {
  return (
    <div className="card" style={{ maxWidth: 560, margin: '48px auto' }}>
      <h1>Page not found</h1>
      <p className="mu">This address does not exist, or the page has moved.</p>
      <p><a className="btn" href="/app">Go to Home</a> <a className="btn s" href="/help">Get help</a></p>
    </div>
  );
}
