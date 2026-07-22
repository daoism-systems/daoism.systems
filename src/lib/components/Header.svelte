<script lang="ts">
	import { hoverSound } from '$lib/utils/hoverSound';
	import { directionalFill } from '$lib/utils/actions/directionalFill';
	import { ctaResonance } from '$lib/utils/actions/ctaResonance';
	import Menu from './Menu.svelte';
	import { onMount } from 'svelte';
	import { useScrollToSection } from '$lib/hooks/useScrollToSection';
	import { loadingFinish, scrollY } from '$lib/store.svelte';

	const { scrollToSection } = useScrollToSection();
	type NavigateSection = (sectionIndex: number) => void | Promise<void>;

	let {
		progress = 0,
		introPhase = 5,
		isMobileIntro = false,
		onNavigateSection = (sectionIndex: number) => scrollToSection(sectionIndex)
	}: {
		progress?: number;
		introPhase?: number;
		isMobileIntro?: boolean;
		onNavigateSection?: NavigateSection;
	} = $props();
	let isLogoRevealed = $derived(introPhase >= 1);
	let areButtonsRevealed = $derived(isMobileIntro ? introPhase >= 2 : introPhase >= 3);

	let menuOpen = $state(false);
	let menuClosing = $state(false);
	let isMobileMenuButtonRevealed = $derived(areButtonsRevealed && !menuOpen && !menuClosing);

	function openMenu() {
		menuClosing = false;
		menuOpen = true;
	}

	$effect(() => {
		if (!menuOpen) return;
		if (typeof window === 'undefined') return;
		// The slide tap tooltip sits at z-index 10001 to stack above the cursor;
		// the menu panel is inside the header stacking context and can't outrank
		// it. Tell the tooltip to hide whenever the menu opens.
		window.dispatchEvent(
			new CustomEvent('slide:tap-tooltip', {
				detail: { visible: false, x: 0, y: 0, text: null, href: null }
			})
		);
	});

	function handleMenuClose() {
		menuClosing = true;
		menuOpen = false;
	}

	function handleMenuClosed() {
		menuClosing = false;
	}

	function handleConnectNowClick() {
		onNavigateSection(7);
	}

	function handleLogoClick(event: MouseEvent) {
		event.preventDefault();
		onNavigateSection(0);
	}

	onMount(() => {
		let lastProgress = 0;
		// Use Lenis-driven scrollY store instead of native scroll events.
		// Native scroll listeners fire redundantly alongside Lenis and can
		// cause layout thrashing on Safari iOS.
		const unsubscribe = scrollY.subscribe((currentProgress: number) => {
			const hidden = currentProgress > lastProgress && currentProgress > 0.01;
			document.body.classList.toggle('header-hidden', hidden);
			lastProgress = currentProgress;
		});

		return unsubscribe;
	});
</script>

<header
	class="header{menuOpen ? ' header--menu-open' : ''}  {$loadingFinish
		? ' header--buttons-no-delay'
		: ''}"
>
	<div class="right-buttons relative">
		<div></div>
		<button
			class="menu-btn {areButtonsRevealed ? 'menu-btn--revealed' : ''}"
			data-cursor-text-label="Open"
			onclick={openMenu}
			use:hoverSound
			use:directionalFill
			use:ctaResonance
		>
			<span class="edge-fill-btn__bg"></span>
			<span class="edge-fill-btn__circle-wrap" aria-hidden="true">
				<span class="edge-fill-btn__circle"></span>
			</span>
			<span class="edge-fill-btn__content">
				<span>Menu</span>
				<svg
					class="menu-btn__icon-desktop"
					viewBox="0 0 16 16"
					fill="none"
					xmlns="http://www.w3.org/2000/svg"
				>
					<path d="M0 0H4.26667V4.26667H0V0Z" fill="currentColor" />
					<path d="M0 11.7333H4.26667V16H0V11.7333Z" fill="currentColor" />
					<path d="M11.7333 0H16V4.26667H11.7333V0Z" fill="currentColor" />
					<path d="M11.7333 11.7333H16V16H11.7333V11.7333Z" fill="currentColor" />
				</svg>
			</span>
		</button>
		<button
			class="connect-btn {areButtonsRevealed ? 'connect-btn--revealed' : ''}"
			data-cursor-text-label="Connect now"
			use:hoverSound
			use:directionalFill
			use:ctaResonance
			onclick={handleConnectNowClick}
		>
			<span class="edge-fill-btn__bg"></span>
			<span class="edge-fill-btn__circle-wrap" aria-hidden="true">
				<span class="edge-fill-btn__circle"></span>
			</span>
			<span class="edge-fill-btn__content">
				<span>Connect Now</span>
				<svg viewBox="0 0 23 23" fill="none" xmlns="http://www.w3.org/2000/svg">
					<path d="M10.62 0.5H12.38V22.5H10.62V0.5Z" fill="currentColor" />
					<path d="M22.5 10.62V12.38L0.5 12.38L0.5 10.62L22.5 10.62Z" fill="currentColor" />
					<path
						d="M7.76645 11.06L11.5 7.32648L15.2335 11.06L11.5 14.7935L7.76645 11.06Z"
						fill="currentColor"
					/>
				</svg>
			</span>
		</button>
	</div>
	<Menu
		bind:open={menuOpen}
		onclose={handleMenuClose}
		onclosed={handleMenuClosed}
		onSectionSelect={onNavigateSection}
	/>
</header>

<!-- The logo sits outside the fixed header: the header's stacking context would
     isolate mix-blend-mode, so blending with the scene only works from here. -->
<a
	href="/"
	class="logo {isLogoRevealed ? 'logo--revealed' : ''}"
	aria-label="Return to the first section"
	onclick={handleLogoClick}
>
	<img src="/icons/logo.svg" alt="daoism systems logo" height="48" />
</a>

<!-- Mobile menu trigger. Mirrors the logo: it lives outside the fixed header so
     mix-blend-mode can blend the icon against the scene, instead of being trapped
     inside the header's stacking context (which keeps it white-on-white). -->
<button
	class="menu-btn-mobile{isMobileMenuButtonRevealed ? ' menu-btn-mobile--revealed' : ''}{$loadingFinish
		? ' menu-btn-mobile--no-delay'
		: ''}"
	aria-label="Open menu"
	onclick={openMenu}
	use:ctaResonance
>
	<span class="menu-btn-mobile__circle-wrap" aria-hidden="true">
		<span class="menu-btn-mobile__circle"></span>
	</span>
	<span class="menu-btn-mobile__content">
		<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
			<path d="M8 8H12.2667V12.2667H8V8Z" fill="white" />
			<path d="M8 19.7333H12.2667V24H8V19.7333Z" fill="white" />
			<path d="M19.7333 8H24V12.2667H19.7333V8Z" fill="white" />
			<path d="M19.7333 19.7333H24V24H19.7333V19.7333Z" fill="white" />
		</svg>
	</span>
</button>

<style lang="scss">
	@use '$lib/styles/variables' as *;

	.right-buttons {
		@media (hover: hover) and (pointer: fine) {
			&:has(.connect-btn:hover) .menu-btn {
				pointer-events: none;
				transform: translateY(-100%);
			}

			// Hide the Connect button if the Menu button is hovered
			&:has(.menu-btn:hover) .connect-btn {
				pointer-events: none;
				transform: translateY(-100%);
			}
		}
	}

	// Add smooth transitions to both buttons
	.menu-btn,
	.connect-btn {
		transition: transform var(--motion-duration-base) var(--motion-ease-standard);
	}

	.header {
		display: flex;
		align-items: flex-start;
		justify-content: flex-end;
		height: fit-content;
		position: fixed;
		top: 0;
		left: 0;
		width: 100vw;
		z-index: 999;
		box-sizing: border-box;
		padding-left: $offset-x;
		pointer-events: none;
		transition: opacity var(--motion-duration-base) var(--motion-ease-standard) 0.2s;

		&--hidden {
			transition: opacity var(--motion-duration-base) var(--motion-ease-standard);
			opacity: 0;

			* {
				pointer-events: none;
			}
		}

		@include breakpoint(phone) {
			padding-left: $offset-x-phone;
			padding-right: $offset-x-phone;

			/* &::after {
				content: '';
				position: absolute;
				inset: 0;
				z-index: -1;
				transition: opacity var(--motion-duration-fast) var(--motion-ease-standard);
				background: linear-gradient(to bottom, rgba(0, 0, 0, 1) 10%, rgba(0, 0, 0, 0));
			} */
		}
	}

	.logo {
		width: 7rem;
		display: flex;
		align-items: center;
		pointer-events: all;
		position: fixed;
		top: $offset-x;
		left: $offset-x;
		z-index: 1000;
		mix-blend-mode: difference;
		transition:
			transform 760ms cubic-bezier(0.22, 1, 0.36, 1),
			opacity 760ms cubic-bezier(0.22, 1, 0.36, 1);
		opacity: 0;
		transform: translateY(-120%);

		@include breakpoint(phone) {
			width: 6.79rem;
			top: 0.75rem;
			left: $offset-x-phone;
		}
	}

	.logo--revealed {
		opacity: 1;
		transform: translateY(0);
		transition-delay: 0.08s;
	}
	.right-buttons {
		display: flex;
		height: 100%;
		justify-content: center;
		align-items: flex-start;
		pointer-events: all;
	}
	.menu-btn,
	.connect-btn {
		--button-enter-y: -110%;
		--cta-shift-x: 0px;
		--cta-shift-y: 0px;
		--cta-scale: 1;
		--button-circle-x: 50%;
		--button-circle-y: 50%;
		--button-circle-size: 160px;
		--edge-fill-bg: #{$color-dark};
		--edge-fill-accent: #{$color-red};
		--edge-fill-text: #fff;
		--edge-fill-text-hover: #fff;

		background: $color-dark;
		background: transparent;
		color: var(--edge-fill-text);
		border: none;
		outline: none;
		padding: 1.4rem 1.25rem 1.9rem 1.25rem;
		margin: 0;
		font-size: 0.9rem;
		font-family: inherit;
		display: flex;
		align-items: center;
		gap: 1rem;
		//cursor: pointer;
		writing-mode: vertical-rl;
		text-orientation: mixed;
		position: relative;
		clip-path: $clip;
		isolation: isolate;
		overflow: hidden;
		width: 3.5rem;
		opacity: 0;
		transform: translate3d(var(--cta-shift-x), var(--button-enter-y), 0) scale(var(--cta-scale));
		transition:
			transform 760ms cubic-bezier(0.22, 1, 0.36, 1),
			opacity 760ms cubic-bezier(0.22, 1, 0.36, 1),
			box-shadow 180ms var(--motion-ease-standard);
		box-shadow: 0 0 0 0 rgba(230, 71, 73, 0);

		@include breakpoint(small-phone) {
			font-size: 1rem;
			width: 3.1rem;
		}

		.edge-fill-btn__content > span {
			transform: scale(-1, -1);
			writing-mode: unset;
		}

		svg {
			color: currentColor;
		}

		@media (hover: hover) and (pointer: fine) {
			&:hover,
			&:focus-visible {
				color: var(--edge-fill-text-hover);

				.edge-fill-btn__circle {
					transform: translate(-50%, -50%) scale(1);
				}
			}
		}

		&:global(.cta-resonance--active) {
			color: var(--edge-fill-text-hover);
			box-shadow:
				0 0 0 1px rgba(230, 71, 73, 0.28),
				0 14px 30px rgba(230, 71, 73, 0.14);

			.edge-fill-btn__circle {
				transform: translate(-50%, -50%) scale(1);
			}
		}
	}

	.menu-btn {
		--edge-fill-bg: #{$color-dark};
		--edge-fill-accent: #{$color-red};
		--edge-fill-text-hover: #fff;

		transition:
			transform 640ms cubic-bezier(0.22, 1, 0.36, 1),
			opacity 640ms cubic-bezier(0.22, 1, 0.36, 1);

		// Mobile uses the standalone `.menu-btn-mobile` trigger (outside the header)
		// so its icon can blend with the scene; this in-header button is desktop-only.
		@include breakpoint(phone) {
			display: none;
		}

		svg {
			width: 1em;
			height: 1em;
			transition: transform var(--motion-duration-fast) var(--motion-ease-standard);
		}

		@media (hover: hover) and (pointer: fine) {
			&:hover,
			&:focus-visible {
				.edge-fill-btn__content svg {
					transform: scale(0.7) rotate(90deg);
				}
			}
		}
	}

	@keyframes menuIconTap {
		0% {
			transform: scale(1) rotate(0deg);
		}
		35% {
			transform: scale(0.68) rotate(-16deg);
		}
		65% {
			transform: scale(1.1) rotate(8deg);
		}
		100% {
			transform: scale(1) rotate(0deg);
		}
	}
	// Standalone mobile menu trigger (markup near the logo). Lives outside the
	// fixed header so mix-blend-mode blends the icon against the scene instead of
	// being isolated inside the header's stacking context (white-on-white).
	.menu-btn-mobile {
		display: none;
	}

	@include breakpoint(phone) {
		.menu-btn-mobile {
			position: fixed;
			top: 0.5rem;
			right: $offset-x-phone;
			z-index: 1000;
			display: flex;
			align-items: center;
			justify-content: center;
			width: 2.75rem;
			height: 2.75rem;
			margin: 0;
			padding: 0;
			border: none;
			outline: none;
			background: transparent;
			border-radius: 999px;
			pointer-events: all;
			mix-blend-mode: difference;
			-webkit-tap-highlight-color: transparent;
			opacity: 0;
			transform: translateY(-110%);
			transition:
				transform 640ms cubic-bezier(0.22, 1, 0.36, 1),
				opacity 640ms cubic-bezier(0.22, 1, 0.36, 1);

			&.menu-btn-mobile--revealed {
				opacity: 1;
				transform: translateY(0);
				transition-delay: 0.18s;
			}

			&.menu-btn-mobile--no-delay {
				transition-delay: 0s;
			}

			.menu-btn-mobile__circle-wrap {
				position: absolute;
				inset: 0;
				overflow: hidden;
				border-radius: 999px;
				z-index: 0;
			}

			.menu-btn-mobile__circle {
				position: absolute;
				top: 50%;
				left: 50%;
				width: 160px;
				height: 160px;
				border-radius: 999px;
				background: $color-red;
				transform: translate(-50%, -50%) scale(0);
				transition: transform 0.72s cubic-bezier(0.625, 0.05, 0, 1);
			}

			.menu-btn-mobile__content {
				position: relative;
				z-index: 1;
				display: inline-flex;
				align-items: center;
				justify-content: center;
				width: 100%;
				height: 100%;
				transition: transform 320ms cubic-bezier(0.34, 1.56, 0.64, 1);
			}

			.menu-btn-mobile__content svg {
				width: 2rem;
				height: 2rem;
				transition: transform 280ms cubic-bezier(0.34, 1.56, 0.64, 1);
				will-change: transform;
			}

			// Juicy press feedback. ctaResonance toggles `cta-resonance--pressed` on
			// pointerdown, which is more reliable than :active on iOS Safari.
			&:active,
			&:global(.cta-resonance--pressed) {
				.menu-btn-mobile__content {
					transform: scale(0.84);
				}

				.menu-btn-mobile__content svg {
					animation: menuIconTap 460ms cubic-bezier(0.34, 1.56, 0.64, 1);
				}

				.menu-btn-mobile__circle {
					transform: translate(-50%, -50%) scale(1);
					opacity: 0.55;
					transition:
						transform 280ms cubic-bezier(0.22, 1, 0.36, 1),
						opacity 360ms ease-out;
				}
			}
		}
	}

	.connect-btn {
		--edge-fill-bg: #{$color-red};
		--edge-fill-accent: #fff;
		--edge-fill-text-hover: #{$color-dark};

		transition:
			transform 640ms cubic-bezier(0.22, 1, 0.36, 1) 0.14s,
			opacity 640ms cubic-bezier(0.22, 1, 0.36, 1) 0.14s;

		@include breakpoint(phone) {
			display: none;
		}
		svg {
			width: 1em;
			height: 1em;
		}

		@media (hover: hover) and (pointer: fine) {
			&:hover,
			&:focus-visible {
				.edge-fill-btn__content svg {
					transform: rotate(90deg);
					transition: transform var(--motion-duration-fast) var(--motion-ease-standard);
				}
			}
		}
	}

	.edge-fill-btn__bg,
	.edge-fill-btn__circle-wrap {
		position: absolute;
		inset: 0;
	}

	.edge-fill-btn__bg {
		background: var(--edge-fill-bg);
		z-index: 0;
	}

	.edge-fill-btn__circle-wrap {
		overflow: hidden;
		z-index: 1;
	}

	.edge-fill-btn__circle {
		position: absolute;
		top: var(--button-circle-y);
		left: var(--button-circle-x);
		width: var(--button-circle-size);
		height: var(--button-circle-size);
		border-radius: 999px;
		background: var(--edge-fill-accent);
		transform: translate(-50%, -50%) scale(0);
		transition:
			transform 0.72s cubic-bezier(0.625, 0.05, 0, 1),
			width 0.72s cubic-bezier(0.625, 0.05, 0, 1),
			height 0.72s cubic-bezier(0.625, 0.05, 0, 1);
	}

	.edge-fill-btn__content {
		position: relative;
		z-index: 2;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 100%;
		gap: 1rem;
	}

	.edge-fill-btn__content > span {
		color: currentColor;
	}

	.edge-fill-btn__content svg {
		position: relative;
		z-index: 1;
		flex-shrink: 0;
	}

	@media (prefers-reduced-motion: reduce) {
		.menu-btn,
		.menu-btn-mobile,
		.menu-btn-mobile__content svg,
		.menu-btn-mobile__circle,
		.connect-btn,
		.edge-fill-btn__circle,
		.edge-fill-btn__content svg {
			transition-duration: 0.01ms !important;
			animation-duration: 0.01ms !important;
		}
	}

	.menu-btn--revealed,
	.connect-btn--revealed {
		opacity: 1;
		--button-enter-y: 0px;
	}

	.menu-btn--revealed {
		transition-delay: 0.18s;
	}

	.connect-btn--revealed {
		transition-delay: 0.28s;
	}

	.header--buttons-no-delay {
		.menu-btn,
		.connect-btn,
		.menu-btn--revealed,
		.connect-btn--revealed {
			transition-delay: 0s;
		}
	}

	:global(.header-hidden) {
		.header::after {
			opacity: 0;
		}

		.logo {
			transition: transform var(--motion-duration-base) var(--motion-ease-standard);
			transform: translateY(-150%);
		}

		@include breakpoint(phone) {
			.header::after {
				opacity: 1;
			}

			.logo {
				transform: translateY(0);
			}
		}
	}
</style>
