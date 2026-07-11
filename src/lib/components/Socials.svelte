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
		href="https://x.com/i/flow/login?redirect_after_login=%2Fdaoism_systems"
		class="social-item"
		target="_blank"
		aria-label="X (Twitter)"
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
			<svg viewBox="0 0 24 20" fill="none" xmlns="http://www.w3.org/2000/svg"
				><path
					d="M23.3588 2.95521C22.5232 3.32575 21.6243 3.57637 20.6816 3.68829C21.6441 3.11163 22.3827 2.19919 22.7314 1.11017C21.8307 1.64443 20.8328 2.032 19.7716 2.2409C18.9214 1.33542 17.71 0.769531 16.3686 0.769531C13.795 0.769531 11.7077 2.85684 11.7077 5.43044C11.7077 5.79576 11.7491 6.15135 11.829 6.49269C7.95543 6.29839 4.52083 4.44292 2.22184 1.62218C1.82071 2.31042 1.5906 3.11163 1.5906 3.96567C1.5906 5.58234 2.41406 7.00957 3.66401 7.84519C2.90034 7.8212 2.18117 7.6116 1.55306 7.26158C1.55272 7.28139 1.55272 7.3012 1.55272 7.32067C1.55272 9.57899 3.16 11.4626 5.2918 11.8905C4.9011 11.9976 4.48851 12.0542 4.06409 12.0542C3.76308 12.0542 3.47144 12.0254 3.18711 11.9711C3.78011 13.8224 5.50105 15.1701 7.54109 15.208C5.94563 16.4583 3.93618 17.2032 1.75189 17.2032C1.37648 17.2032 1.00456 17.1813 0.640625 17.1378C2.70221 18.4608 5.15276 19.2321 7.78476 19.2321C16.3579 19.2321 21.0462 12.13 21.0462 5.97026C21.0462 5.7683 21.0417 5.56705 21.0327 5.36753C21.9441 4.71057 22.7341 3.8899 23.3588 2.95521Z"
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
		href="https://mirror.xyz/"
		class="social-item"
		target="_blank"
		aria-label="Mirror"
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
			<svg viewBox="0 0 16 20" fill="none" xmlns="http://www.w3.org/2000/svg"
				><path
					d="M0.5 7.5C0.5 3.35786 3.85786 0 8 0C12.1421 0 15.5 3.35786 15.5 7.5V20H0.5V7.5Z"
					fill="currentColor"
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
