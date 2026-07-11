<script lang="ts">
	import { hoverSound } from '$lib/utils/hoverSound';
	import { directionalFill } from '$lib/utils/actions/directionalFill';

	const CURSOR_VISIBILITY_EVENT = 'cursor:set-hidden';

	export let theme: 'dark' | 'light' = 'light';

	function setCursorHidden(hidden: boolean) {
		if (typeof window === 'undefined') return;
		window.dispatchEvent(
			new CustomEvent(CURSOR_VISIBILITY_EVENT, {
				detail: { hidden }
			})
		);
	}

	function handleSocialHoverStart() {
		setCursorHidden(true);
	}

	function handleSocialHoverEnd() {
		setCursorHidden(false);
	}
</script>

<div class="socials socials--{theme}">
	<a
		use:hoverSound
		use:directionalFill
		href="https://x.com/daoism_systems"
		class="social-item"
		target="_blank"
		aria-label="X"
		onmouseenter={handleSocialHoverStart}
		onmouseleave={handleSocialHoverEnd}
		onfocus={handleSocialHoverStart}
		onblur={handleSocialHoverEnd}
	>
		<span class="social-item__bg"></span>
		<span class="social-item__circle-wrap" aria-hidden="true">
			<span class="social-item__circle"></span>
		</span>
		<div class="social-icon-group">
			<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"
				><path
					d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117l11.966 15.644Z"
					fill="currentColor"
				/></svg>
		</div>
	</a>

	<a
		use:hoverSound
		use:directionalFill
		href="https://t.me/+EBSNTw1oFipjZTQ1"
		class="social-item"
		target="_blank"
		aria-label="Telegram"
		onmouseenter={handleSocialHoverStart}
		onmouseleave={handleSocialHoverEnd}
		onfocus={handleSocialHoverStart}
		onblur={handleSocialHoverEnd}
	>
		<span class="social-item__bg"></span>
		<span class="social-item__circle-wrap" aria-hidden="true">
			<span class="social-item__circle"></span>
		</span>
		<div class="social-icon-group">
			<svg viewBox="0 0 22 20" fill="none" xmlns="http://www.w3.org/2000/svg"
				><path
					d="M8.63262 13.1813L8.2687 18.7653C8.78938 18.7653 9.01488 18.5213 9.2853 18.2283L11.7264 15.6833L16.7847 19.7243C17.7124 20.2883 18.366 19.9913 18.6163 18.7933L21.9365 1.8214L21.9374 1.8204C22.2317 0.324404 21.4415 -0.260593 20.5377 0.106405L1.02135 8.25736C-0.310594 8.82136 -0.290427 9.63136 0.794932 9.99835L5.78447 11.6913L17.3742 3.78039C17.9196 3.38639 18.4155 3.60439 18.0076 3.99839L8.63262 13.1813Z"
					fill="currentColor"
				/></svg>
		</div>
	</a>

	<a
		use:hoverSound
		use:directionalFill
		href="https://paragraph.com/@0013700"
		class="social-item"
		target="_blank"
		aria-label="Paragraph"
		onmouseenter={handleSocialHoverStart}
		onmouseleave={handleSocialHoverEnd}
		onfocus={handleSocialHoverStart}
		onblur={handleSocialHoverEnd}
	>
		<span class="social-item__bg"></span>
		<span class="social-item__circle-wrap" aria-hidden="true">
			<span class="social-item__circle"></span>
		</span>
		<div class="social-icon-group">
			<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"
				><path
					d="M13 4v16m4-16v16M19 4H9.5a4.5 4.5 0 0 0 0 9H13"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				/></svg>
		</div>
	</a>
</div>

<style lang="scss">
	@use '$lib/styles/variables' as *;

	$ease-custom: cubic-bezier(0.625, 0.05, 0, 1);

	.socials {
		display: flex;
		gap: 0.5rem;
		color: #fff;

		&--dark {
			color: #000;
			@media (max-width: 1024px) {
				padding-bottom: 1rem;
				border-bottom: 1px solid #ccc;
			}
		}
	}

	.social-item {
		--button-circle-x: 50%;
		--button-circle-y: 50%;
		--button-circle-size: 160px;
		--social-fill: #fff;

		width: 3.5rem;
		aspect-ratio: 1;
		border-radius: 0.25rem;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(#fff, 0.1);
		position: relative;
		overflow: hidden;
		text-decoration: none;

		color: currentColor;

		@include breakpoint(phone) {
			width: 3.5rem;
		}

		.socials--dark & {
			background: rgba($color-grey-400, 0.1);
			--social-fill: #29292e;
		}
	}

	.social-item__bg,
	.social-item__circle-wrap {
		position: absolute;
		inset: 0;
		border-radius: inherit;
	}

	.social-item__bg {
		background: currentColor;
		opacity: 0;
		transition: opacity 0.24s ease;
		z-index: 0;
	}

	.social-item__circle-wrap {
		overflow: hidden;
		z-index: 1;
	}

	.social-item__circle {
		position: absolute;
		top: var(--button-circle-y);
		left: var(--button-circle-x);
		width: var(--button-circle-size);
		height: var(--button-circle-size);
		min-width: calc(220% + 1rem);
		min-height: calc(220% + 1rem);
		border-radius: 999px;
		background: var(--social-fill);
		transform: translate(-50%, -50%) scale(0);
		transform-origin: center;
		transition:
			transform 0.72s cubic-bezier(0.625, 0.05, 0, 1),
			width 0.72s cubic-bezier(0.625, 0.05, 0, 1),
			height 0.72s cubic-bezier(0.625, 0.05, 0, 1);
	}

	// Wrapper for SVGs
	.social-icon-group {
		position: relative;
		z-index: 2;
		display: flex;
		align-items: center;
	}

	svg {
		width: auto;
		height: 1.25rem;
		display: block;
		flex-shrink: 0;
		transition: color 0.4s ease-in-out;

		@include breakpoint(phone) {
			height: 1rem;
		}
	}

	@media (hover: hover) and (pointer: fine) {
		.social-item:hover {
			.social-item__circle {
				transform: translate(-50%, -50%) scale(1);
			}

			svg {
				color: white;
			}
		}
	}
</style>
