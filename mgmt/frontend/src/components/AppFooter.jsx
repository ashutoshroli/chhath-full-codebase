// Shared footer for the mgmt portal — copyright with an auto-updating year and a
// "Made with 🩷" line. Rendered on the login screen and under the main app shell
// so it appears on every screen. Kept muted and centered; on mobile the app has a
// fixed bottom-nav (65px), so the footer adds bottom spacing to clear it.
// `compact` = no fixed bottom-nav on this screen (e.g. the login page), so the
// footer doesn't need to reserve room to clear it.
export default function AppFooter({ compact = false }) {
  const year = new Date().getFullYear();
  return (
    <footer
      style={{
        maxWidth: 1000,
        margin: '40px auto 0',
        // Clear the fixed .bottom-nav (65px) on mobile; body has no bottom
        // padding here, so reserve space explicitly. On screens without the nav
        // (login) a small bottom padding is enough.
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
        © {year} Navyuvak Chhath Puja Samiti, Shaharpura. All rights reserved.
      </p>
      <p style={{ margin: '4px 0', opacity: 0.9 }}>
        Made with <span style={{ verticalAlign: '-1px' }} aria-label="love">🩷</span> for Shaharpura &amp; Gardih
      </p>
    </footer>
  );
}
