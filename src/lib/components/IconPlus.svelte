<script lang="ts">
	let { top = [''], left = [''], right = '', bottom = '', desktopHide = false, hidden = false } = $props();

	let topDesktop = $derived(Array.isArray(top) ? (top[0] ?? '') : top);
	let topPhone = $derived(Array.isArray(top) && top.length > 1 ? top[1] : topDesktop);
	let leftDesktop = $derived(Array.isArray(left) ? (left[0] ?? '') : left);
	let leftPhone = $derived(Array.isArray(left) && left.length > 1 ? left[1] : leftDesktop);
</script>

<span
	class="icon{desktopHide ? ' desktop-hide' : ''}{hidden ? ' is-hidden' : ''}"
	style="
		--top-desktop: {topDesktop};
		--top-phone: {topPhone};
		--left-desktop: {leftDesktop};
		--left-phone: {leftPhone};
		--right: {right};
		--bottom: {bottom};
	"
>
	<img src="/icons/plus.svg" alt="plus icon" />
</span>

<style lang="scss">
	@use '$lib/styles/variables' as *;

	.icon {
		position: absolute;
		width: 1rem;
		height: 1rem;
		color: $color-grey-100;
		animation: scale-rotate 3.6s ease-in-out infinite;
		opacity: 1;
		transform: scale(1);
		transition:
			opacity 0.35s cubic-bezier(0.22, 0.61, 0.36, 1),
			transform 0.35s cubic-bezier(0.22, 0.61, 0.36, 1);

		top: var(--top-desktop);
		left: var(--left-desktop);
		right: var(--right);
		bottom: var(--bottom);

		@include breakpoint(phone) {
			top: var(--top-phone);
			left: var(--left-phone);
			right: var(--right);
			bottom: var(--bottom);
			width: 0.68rem;
			height: 0.68rem;
		}

	}

	.icon.is-hidden {
		opacity: 0;
		transform: scale(0.85);
		pointer-events: none;
	}
</style>
