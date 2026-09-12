export default function AppFooter({ compact = false }) {
  const year = new Date().getFullYear();
  return (
    <footer
      style={{
        maxWidth: 1000,
        margin: '40px auto 0',
        paddingBottom: compact ? 24 : 'calc(65px + env(safe-area-inset-bottom, 0px) + 16px)',
        paddingTop: 18,
        borderTop: '1px solid rgba(0,0,0,0.08)',
        textAlign: 'center',
        color: 'var(--text-muted, #6b7280)',
        fontSize: '0.78rem',
        lineHeight: 1.5,
      }}
    >
      <p style={{ margin: '4px 0' }}>
        © {year} Navyuvak Chhath Puja Samiti, Shaharpura &amp; Gardih. All rights reserved.
      </p>
      <p style={{ margin: '4px 0', opacity: 0.9 }}>
        Made with <span style={{ verticalAlign: '-1px' }} aria-label="love">🩷</span>
      </p>
    </footer>
  );
}
