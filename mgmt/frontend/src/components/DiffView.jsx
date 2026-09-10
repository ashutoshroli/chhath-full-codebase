// Minimal unified-diff renderer for the AI fix preview. Colours added/removed/
// hunk lines like a normal code review. Presentational only — takes a raw diff
// string and displays it; it does not parse or apply anything.
function lineStyle(line) {
  if (line.startsWith('+++') || line.startsWith('---')) {
    return { color: '#6b7280', fontWeight: 600 };
  }
  if (line.startsWith('@@')) {
    return { color: '#8250df', background: '#f6f0ff' };
  }
  if (line.startsWith('diff ') || line.startsWith('index ')) {
    return { color: '#6b7280' };
  }
  if (line.startsWith('+')) {
    return { color: '#116329', background: '#e6ffec' };
  }
  if (line.startsWith('-')) {
    return { color: '#82071e', background: '#ffebe9' };
  }
  return { color: '#24292f' };
}

export default function DiffView({ diff }) {
  const text = (diff || '').toString();
  if (!text.trim()) {
    return <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>No diff to show.</div>;
  }
  const lines = text.split('\n');
  return (
    <pre
      style={{
        margin: 0, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8,
        padding: 0, fontSize: '0.72rem', lineHeight: 1.5, overflowX: 'auto',
        maxHeight: 420, overflowY: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      }}
    >
      {lines.map((line, i) => (
        <div key={i} style={{ ...lineStyle(line), padding: '0 10px', whiteSpace: 'pre' }}>
          {line || ' '}
        </div>
      ))}
    </pre>
  );
}
