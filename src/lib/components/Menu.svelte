<script lang="ts">
	import { onMount } from 'svelte';
	import Socials from './Socials.svelte';
	import { AnimationTimeline } from '$lib/utils/animations/helpers/animationTimeline';
	import { EASINGS } from '$lib/utils/animations/constants/easings';
	import { useScrollToSection } from '$lib/hooks/useScrollToSection';
	import { hoverSound } from '$lib/utils/hoverSound';
	import { directionalFill } from '$lib/utils/actions/directionalFill';

	let {
		open = $bindable(false),
		onclose,
		onclosed,
		onSectionSelect = (sectionIndex: number) => scrollToSection(sectionIndex)
	}: {
		open: boolean;
		onclose?: () => void;
		onclosed?: () => void;
		onSectionSelect?: (sectionIndex: number) => void | Promise<void>;
	} = $props();

	const EASE_BORDER_DRAW = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)';
	const CURSOR_VISIBILITY_EVENT = 'cursor:set-hidden';

	const sections = [
		{ label: 'ABOUT US', index: 1 },
		{ label: 'SERVICES', index: 2 },
		{ label: 'COLLABORATION', index: 3 },
		{ label: 'INSIGHTS', index: 4 },
		{ label: 'PARTNERS', index: 5 },
		{ label: 'PROCESS', index: 6 }
	];
	const CONTACT_INDEX = 7;
	const menuItemBindings = sections.map((_, index) => ({ index }));

	let menuEl: HTMLDivElement;
	let closeBtn: HTMLButtonElement;
	let menuItems: (HTMLSpanElement | null)[] = [];
	let socialsEl: HTMLDivElement;
	let contactTextEl: HTMLDivElement;
	let contactBorderEl: HTMLDivElement;
	let contactCtaEl: HTMLButtonElement;
	let prefersReducedMotion = $state(false);

	let tl: AnimationTimeline | null = null;

	function closeMenu() {
		setCursorHidden(false);
		tl?.reverse();
		onclose?.();
	}

	const { scrollToSection } = useScrollToSection();

	function handleSectionClick(idx: number) {
		onSectionSelect(idx);
		closeMenu();
	}

	function setCursorHidden(hidden: boolean) {
		if (typeof window === 'undefined') return;
		window.dispatchEvent(
			new CustomEvent(CURSOR_VISIBILITY_EVENT, {
				detail: { hidden }
			})
		);
	}

	function handleSectionLinkClick(event: MouseEvent, idx: number) {
		event.preventDefault();
		setCursorHidden(false);
		handleSectionClick(idx);
	}

	function handleMenuLinkHoverStart() {
		setCursorHidden(true);
	}

	function handleMenuLinkHoverEnd() {
		setCursorHidden(false);
	}

	function collectMenuItem(node: HTMLSpanElement, { index }: { index: number }) {
		menuItems[index] = node;
		return {
			destroy() {
				menuItems[index] = null;
			}
		};
	}

	onMount(() => {
		prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		tl = new AnimationTimeline({
			onReverseComplete: () => onclosed?.()
		});
		tl.add(
			menuEl,
			[
				{ transform: 'translate3d(0, -104%, 0)' },
				{ transform: 'translate3d(0, 0%, 0)' }
			],
			{
				duration: 860,
				easing: EASINGS.EASE_POWER2_OUT,
				reverseEasing: EASINGS.EASE_POWER2_IN
			},
			0
		);

		const panels = Array.from(menuEl.querySelectorAll<HTMLElement>('[data-sidenav-panel]'));
		tl.add(
			panels,
			[
				{ transform: 'translate3d(0, -1.4rem, 0)' },
				{ transform: 'translate3d(0, 0, 0)' }
			],
			{
				duration: 680,
				easing: EASINGS.EASE_POWER2_OUT,
				reverseEasing: EASINGS.EASE_POWER2_IN
			},
			0,
			36
		);

		tl.add(
			closeBtn,
			[
				{ transform: 'translate3d(0, -1rem, 0) rotate(-45deg) scale(0.82)', opacity: '0' },
				{ transform: 'translate3d(0, 0, 0) rotate(0deg) scale(1)', opacity: '1' }
			],
			{
				duration: 560,
				easing: EASINGS.EASE_POWER2_OUT,
				reverseEasing: EASINGS.EASE_POWER2_IN
			},
			110
		);

		const validItems = menuItems.filter(Boolean) as HTMLElement[];
		tl.add(
			validItems,
			[
				{ transform: 'translate3d(0, 115%, 0) rotate(2deg)', opacity: '0.2' },
				{ transform: 'translate3d(0, 0%, 0) rotate(0deg)', opacity: '1' }
			],
			{
				duration: 620,
				easing: EASINGS.EASE_CUSTOM_REVEAL,
				reverseEasing: EASINGS.EASE_POWER2_IN
			},
			150,
			44
		);

		tl.add(
			contactCtaEl,
			[
				{ opacity: '0', transform: 'translate3d(0, 1rem, 0) scale(0.985)' },
				{ opacity: '1', transform: 'translate3d(0, 0, 0) scale(1)' }
			],
			{
				duration: 520,
				easing: EASINGS.EASE_POWER2_OUT,
				reverseEasing: EASINGS.EASE_POWER2_IN
			},
			390
		);

		tl.add(
			contactBorderEl,
			[{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }],
			{
				duration: 460,
				easing: EASE_BORDER_DRAW,
				reverseEasing: EASINGS.EASE_POWER2_IN
			},
			450
		);

		tl.add(
			contactTextEl,
			[
				{ opacity: '0', transform: 'translate3d(0, 0.8rem, 0)' },
				{ opacity: '1', transform: 'translate3d(0, 0, 0)' }
			],
			{
				duration: 480,
				easing: EASINGS.EASE_POWER2_OUT,
				reverseEasing: EASINGS.EASE_POWER2_IN
			},
			480
		);

		const socialItems = Array.from(socialsEl.querySelectorAll<HTMLElement>('.social-item'));
		tl.add(
			socialItems,
			[
				{ opacity: '0', transform: 'translate3d(0, 0.7rem, 0) scale(0.94)' },
				{ opacity: '1', transform: 'translate3d(0, 0, 0) scale(1)' }
			],
			{
				duration: 420,
				easing: EASINGS.EASE_POWER2_OUT,
				reverseEasing: EASINGS.EASE_POWER2_IN
			},
			520,
			28
		);

		return () => {
			tl?.destroy();
			tl = null;
		};
	});

	$effect(() => {
		if (!tl) return;
		if (prefersReducedMotion) {
			tl.setProgress(open ? 1 : 0);
			if (!open) onclosed?.();
			return;
		}
		if (open) {
			tl.timeScale = 1;
			tl.play();
		} else {
			tl.timeScale = 1.25;
			tl.reverse();
		}
	});
</script>

<div class="menu" bind:this={menuEl}>
	<div data-sidenav-panel="" class="sidenav__menu-bg-panel is--first"></div>
	<div data-sidenav-panel="" class="sidenav__menu-bg-panel is--second"></div>
	<div data-sidenav-panel="" class="sidenav__menu-bg-panel"></div>

	<button
		use:hoverSound
		class="menu-close"
		data-cursor-text-label="Return"
		bind:this={closeBtn}
		onclick={closeMenu}
		aria-label="Close menu"
	>
		<svg
			class="menu-close__icon"
			viewBox="0 0 24 24"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
		>
			<line
				x1="5"
				y1="5"
				x2="19"
				y2="19"
				stroke="currentColor"
				stroke-width="1.6"
				stroke-linecap="round"
			/>
			<line
				x1="19"
				y1="5"
				x2="5"
				y2="19"
				stroke="currentColor"
				stroke-width="1.6"
				stroke-linecap="round"
			/>
		</svg>
	</button>
	<div class="menu__wrap relative">
		<nav class="menu-nav">
			{#each sections as section, i}
				<a
					use:hoverSound
					class="menu-link text-lg"
					href={`#section-${section.index}`}
					aria-label={`Scroll to ${section.label}`}
					onmouseenter={handleMenuLinkHoverStart}
					onmouseleave={handleMenuLinkHoverEnd}
					onfocus={handleMenuLinkHoverStart}
					onblur={handleMenuLinkHoverEnd}
					onclick={(event) => handleSectionLinkClick(event, section.index)}
				>
					<span use:collectMenuItem={menuItemBindings[i]} class="menu-link__inner">
						<span class="menu-link__arrow" aria-hidden="true">
							<svg
								class="menu-link__arrow-svg"
								xmlns="http://www.w3.org/2000/svg"
								viewBox="0 0 24 24"
								fill="none"
							>
								<polyline
									points="18 8 18 18 8 18"
									stroke="currentColor"
									stroke-miterlimit="10"
									stroke-width="1.5"
								/>
								<line
									x1="18"
									y1="18"
									x2="5"
									y2="5"
									stroke="currentColor"
									stroke-miterlimit="10"
									stroke-width="1.5"
								/>
							</svg>
						</span>
						<span class="menu-link__content" use:directionalFill>
							<span class="menu-link__content-circle-wrap" aria-hidden="true">
								<span class="menu-link__content-circle"></span>
							</span>
							<span class="menu-link__content-label">
								<span class="menu-link__text">{section.label}</span>
							</span>
						</span>
					</span>
				</a>
			{/each}
		</nav>

		<button
			bind:this={contactCtaEl}
			class="menu-contact-cta"
			data-cursor-text-label="Send"
			onclick={() => handleSectionClick(CONTACT_INDEX)}
			use:hoverSound
			use:directionalFill
			aria-label="Contact us"
		>
			<span class="edge-fill-btn__bg"></span>
			<span class="edge-fill-btn__circle-wrap" aria-hidden="true">
				<span class="edge-fill-btn__circle"></span>
			</span>
			<span class="menu-contact-cta__content">
				<span class="menu-contact-cta__label">Contact Us</span>
			</span>
		</button>

		<!--<AudioVisualiser isMenu />-->
		<div class="menu-contact-border" bind:this={contactBorderEl}></div>
		<div class="menu-contact-text" bind:this={contactTextEl}>
			<p class="text-sm text-[#a8aebc]">You can contact us via this contact form or through social networks.</p>
		</div>
		<div class="menu__socials" bind:this={socialsEl}>
			<Socials theme="dark" />
		</div>
		<!--<div class="menu-socials-border" bind:this={socialsBorderEl}></div>-->
	</div>
</div>

<style lang="scss">
	@use '$lib/styles/variables' as *;

	.menu {
		position: absolute;
		top: 0;
		right: 0;
		z-index: 12;
		width: 23.4rem;
		pointer-events: all;
		isolation: isolate;
		overflow: hidden;
		transform: translate3d(0, -104%, 0);
		will-change: transform;

		&__wrap {
			padding: 1.2rem;
		}
	}

	.text-sm {
        font-size: 15px;
        font-weight: 500;
        line-height: 120%;
        word-spacing: $word-spacing;
	}

	@include breakpoint(phone) {
		.menu {
			position: fixed;
			inset: 0;
			width: 100vw;
			height: 100dvh;
		}

		.menu__wrap {
			min-height: 100%;
			display: flex;
			flex-direction: column;
			overflow-y: auto;
			box-sizing: border-box;
			padding: 0.75rem;
			padding-top: 5.5rem;
		}

		.menu-nav {
			gap: 1rem;
			box-sizing: border-box;
			margin: -1.25rem -1rem 0;
			padding: 1.25rem 2.5rem 0 1rem;
		}

		.menu-link {
			font-size: 24px;
			line-height: 0.9;
			letter-spacing: 0.01em;
			word-spacing: $word-spacing;
			padding: 0.1rem 0;
		}

		// Collapse the hover-pill min-height on touch so item rhythm matches the
		// design's line-height:0.9 + 16px gap (the pill never shows without hover).
		.menu-link .menu-link__content {
			min-height: 0;
		}

		.menu-contact-border {
			margin: 1.8rem 0 0.4rem;
		}

		.menu-contact-text {
			margin: 0 0 1.15rem;
			padding-top: 0.5rem;
			/* font-family: $font-secondary; */
		}

		.menu-contact-text p {
			max-width: 100%;
		}

		.menu-socials-border {
			margin: 1.1rem 0 0.6rem;
		}

		.menu__socials :global(.social-item) {
			width: 3.7rem;
		}

		:global(#audio-visualiser) {
			margin-top: 0;
		}

		:global(#audio-visualiser #oscilloscope) {
			width: 100%;
		}
	}

	.menu-audio {
		@include breakpoint(phone) {
			margin-top: 0.2rem;
		}
	}

	.menu-close {
		position: absolute;
		top: 0.6rem;
		right: 0.6rem;
		background: transparent;
		color: $color-dark;
		border: none;
		padding: 0.75rem;
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 10;
		line-height: 0;
		will-change: transform, opacity;

		@include breakpoint(phone) {
			top: 0.5rem;
			right: 0.5rem;
			padding: 0.6rem;
		}

		&__icon {
			width: 1.5rem;
			height: 1.5rem;
			transition: transform var(--motion-duration-base) var(--motion-ease-standard);
		}

		@media (hover: hover) and (pointer: fine) {
			&:hover,
			&:focus-visible {
				color: $color-red;

				.menu-close__icon {
					transform: rotate(90deg);
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
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
	}
	.menu-close__label {
		writing-mode: vertical-rl;
		transform: rotate(180deg);
		font-size: 0.9rem;
		margin-bottom: 0.5rem;
		letter-spacing: 0.03em;
	}
	.menu-nav {
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		//gap: 0.6rem;
		margin: -1.2rem -1.2rem 0;
		padding: 1.2rem 5.2rem 0 1.2rem;
	}
	.menu-link {
		--menu-link-pill-size: 1.7em;
		--menu-link-padding-x: 0.9em;
		--menu-link-gap: 0.3em;
		--button-circle-x: 50%;
		--button-circle-y: 50%;
		--button-circle-size: 160px;

		position: relative;
		right: 18px;
		width: fit-content;
		max-width: 100%;
		font-family: $font-secondary;
		color: #20242d;
		text-decoration: none;
		display: inline-block;
		overflow: hidden;
		position: relative;
		transition:
			color var(--motion-duration-base) var(--motion-ease-standard),
			transform var(--motion-duration-base) var(--motion-ease-standard),
			right var(--motion-duration-base) var(--motion-ease-standard);
		will-change: transform, opacity, right;

		&__inner {
			display: inline-block;
			transform-origin: left bottom;
			will-change: transform, opacity;
		}

		&__arrow {
			color: $color-dark;
			background: $color-red;
			border-radius: 999px;
			display: flex;
			justify-content: center;
			align-items: center;
			width: var(--menu-link-pill-size);
			height: var(--menu-link-pill-size);
			position: absolute;
			top: 0;
			left: 0;
			overflow: hidden;
			opacity: 0;
			transition:
				opacity 0.42s ease,
				transform 0.735s cubic-bezier(0.625, 0.05, 0, 1);
			transform: scale(0.82) translateX(-0.18em) rotate(0.001deg);
			transform-origin: center;
			z-index: 2;
		}

		&__arrow-svg {
			width: 0.72em;
			height: auto;
			transition: transform 0.735s cubic-bezier(0.625, 0.05, 0, 1);
			transform: rotate(0.001deg);
		}

		&__content {
			color: inherit;
			border-radius: 999px;
			display: flex;
			align-items: center;
			justify-content: center;
			min-height: var(--menu-link-pill-size);
			padding-left: var(--menu-link-padding-x);
			padding-right: var(--menu-link-padding-x);
			position: relative;
			isolation: isolate;
			overflow: hidden;
			transition:
				color var(--motion-duration-fast) var(--motion-ease-standard),
				padding-left 0.735s cubic-bezier(0.625, 0.05, 0, 1);
			transform: translateX(0) rotate(0.001deg);
		}

		&__content-circle-wrap {
			position: absolute;
			inset: 0;
			border-radius: inherit;
			overflow: hidden;
			z-index: 0;
		}

		&__content-circle {
			position: absolute;
			top: var(--button-circle-y);
			left: var(--button-circle-x);
			width: var(--button-circle-size);
			height: var(--button-circle-size);
			min-width: calc(300% + 1rem);
			min-height: calc(300% + 1rem);
			border-radius: 999px;
			background: #29292e;
			transform: translate(-50%, -50%) scale(0);
			transform-origin: center;
			transition:
				transform 0.72s cubic-bezier(0.625, 0.05, 0, 1),
				width 0.72s cubic-bezier(0.625, 0.05, 0, 1),
				height 0.72s cubic-bezier(0.625, 0.05, 0, 1);
		}

		&__content-label {
			position: relative;
			z-index: 1;
			display: inline-flex;
			align-items: center;
			justify-content: center;
			width: 100%;
			height: 100%;
		}

		&__text {
			display: block;
			line-height: 1;
			white-space: nowrap;
		}

		@media (hover: hover) and (pointer: fine) {
			&:hover,
			&:focus-visible {
				right: 9px !important;

				.menu-link__content {
					color: #fff;
					padding-left: calc(
						var(--menu-link-padding-x) + var(--menu-link-pill-size) + var(--menu-link-gap)
					);
				}

				.menu-link__content-circle {
					transform: translate(-50%, -50%) scale(1);
				}

				.menu-link__arrow-svg {
					transform: rotate(-45deg);
				}

				.menu-link__arrow {
					opacity: 1;
					transform: scale(1) translateX(0) rotate(0.001deg);
				}
			}
		}
	}
	.menu-contact-cta {
		--button-circle-x: 50%;
		--button-circle-y: 50%;
		--button-circle-size: 540px;
		--edge-fill-bg: #{$color-red};
		--edge-fill-accent: #{$color-dark};
		--edge-fill-text: #fff;
		--edge-fill-text-hover: #fff;

		position: relative;
		display: block;
		width: 100%;
		height: 3rem;
		margin-top: 1.5rem;
		padding: 0;
		background: transparent;
		color: var(--edge-fill-text);
		border: none;
		outline: none;
		font-family: $font-main;
		font-size: 1rem;
		letter-spacing: 0.02em;
		clip-path: $clip;
		isolation: isolate;
		overflow: hidden;
		opacity: 0;
		transition:
			color var(--motion-duration-fast) var(--motion-ease-standard),
			box-shadow 180ms var(--motion-ease-standard);

		&::before {
			content: '';
			position: absolute;
			top: 0;
			left: 0;
			width: 4px;
			height: 100%;
			background: #fff;
			z-index: 3;
			pointer-events: none;
		}

		&__content {
			position: relative;
			z-index: 2;
			display: flex;
			align-items: center;
			justify-content: center;
			width: 100%;
			height: 100%;
		}

		&__label {
			color: inherit;
			line-height: 1;
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

		@include breakpoint(phone) {
			margin-top: auto;
		}
	}

	.menu-contact-text {
		color: $color-grey-bg;
		margin-bottom: 1.2rem;
		padding-top: 0.8rem;
		font-weight: 500;
		margin: 0 0 2rem;

		@include breakpoint(phone) {
			margin: 0 0 1.5rem;
		}

		p {
			max-width: 85%;

			@include breakpoint(phone) {
				max-width: 100%;
			}
		}
	}

	.menu-contact-border {
		height: 1px;
		background: #ccc;
		margin: 3.6rem 0 0.2rem;
		transform-origin: left center;
		transform: scaleX(0);

		@include breakpoint(phone) {
			margin-top: 1rem;
		}
	}

	.menu-socials-border {
		display: none;
		height: 1px;
		background: #ccc;
		transform-origin: left center;
		transform: scaleX(0);

		@media (max-width: 1024px) {
			display: block;
			margin: 2.8rem 0 1rem;
		}

		@include breakpoint(phone) {
			margin: 1rem 0 0;
		}
	}

	@media (max-width: 1024px) {
		.menu__socials :global(.socials--dark) {
			padding-bottom: 0;
			border-bottom: none;
		}
	}

	.sidenav__menu-bg-panel {
		z-index: 0;
		background-color: white;
		position: absolute;
		inset: 0%;
		will-change: transform;
	}

	.sidenav__menu-bg-panel.is--first {
		background-color: #e64749;
	}

	.sidenav__menu-bg-panel.is--second {
		background-color: #121214;
	}

	@media (prefers-reduced-motion: reduce) {
		.menu,
		.menu-close,
		.menu-link__inner,
		.menu-contact-cta,
		.menu-contact-border,
		.menu-contact-text,
		.menu__socials :global(.social-item),
		.sidenav__menu-bg-panel {
			will-change: auto;
		}
	}
</style>
