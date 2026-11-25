'use client';

// Replaces the whole document when the root layout itself fails, so it cannot rely on the app's styles.
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en-IN">
      <body style={{ background: '#080b12', color: '#e8ecf4', fontFamily: 'system-ui, sans-serif', padding: 48 }}>
        <h1>ATLAS could not start this page</h1>
        <p>Your saved work is not affected.</p>
        <p><button onClick={reset}>Try again</button></p>
      </body>
    </html>
  );
}
