<script lang="ts">
	import { displayedLoadingProgress } from '$lib/store.svelte';
</script>

<div
	class="preloader-status absolute bottom-5 left-5 flex items-center gap-4 rounded-sm border-[0.5px] border-[#a8aebc4d] bg-[#2B2C30]/95 px-4 py-1.5 text-sm text-[#A8AEBC]"
>
	{Math.round($displayedLoadingProgress)}
	<svg width="6" height="6" viewBox="0 0 6 6" fill="none" xmlns="http://www.w3.org/2000/svg">
		<rect y="2.82837" width="4" height="4" transform="rotate(-45 0 2.82837)" fill="#A8AEBC" />
	</svg>
	Loading
</div>

<style>
	.preloader-status {
		z-index: 2;
	}
</style>
