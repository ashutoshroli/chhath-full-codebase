<script lang="ts">
  import { activeSkin } from '$lib/stores/skin';
  let Page = $derived($activeSkin.pages.Decade);
</script>

<Page />
