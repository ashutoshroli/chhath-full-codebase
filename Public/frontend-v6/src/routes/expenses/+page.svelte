<script lang="ts">
  import { activeSkin } from '$lib/stores/skin';
  let Page = $derived($activeSkin.pages.Expenses);
</script>

<Page />
