'use client';
import { useEffect } from 'react';

export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="card" style={{ maxWidth: 560, margin: '48px auto' }} role="alert">
      <h1>This page could not be shown</h1>
      <p className="mu">Something went wrong while drawing it. Your saved work is not affected.</p>
      {error.digest && <p className="mu">Reference: {error.digest}</p>}
      <p><button className="btn" onClick={reset}>Try again</button> <a className="btn s" href="/app">Go to Home</a></p>
    </div>
  );
}
