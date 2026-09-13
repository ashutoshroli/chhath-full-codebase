<script lang="ts">
  // Ported from React AppFooter.jsx — identical inline styles.
  interface Props {
    compact?: boolean;
  }
  let { compact = false }: Props = $props();
  const year = new Date().getFullYear();
</script>

<footer
  style="max-width:1000px; margin:40px auto 0;
    padding-bottom:{compact ? '24px' : 'calc(65px + env(safe-area-inset-bottom, 0px) + 16px)'};
    padding-top:18px; border-top:1px solid rgba(0,0,0,0.08); text-align:center;
    color:var(--text-muted, #6b7280); font-size:0.78rem; line-height:1.5;"
>
  <p style="margin:4px 0;">© {year} Navyuvak Chhath Puja Samiti, Shaharpura &amp; Gardih. All rights reserved.</p>
  <p style="margin:4px 0; opacity:0.9;">Made with <span style="vertical-align:-1px" aria-label="love">🩷</span></p>
</footer>
