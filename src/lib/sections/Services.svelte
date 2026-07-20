<script lang="ts">
	import Heading from '$lib/components/Heading.svelte';
	import IconPlus from '$lib/components/IconPlus.svelte';
	import { clamp01, getUiProgress, smoothstep } from '$lib/utils/animations/uiProgress';

	let { progress } = $props();

	const SERVICES_CARDS = [
		{
			id: 1,
			title: 'We Develop',
			items: [
				'Smart Contracts',
				'User Interfaces',
				'Interoperability Solutions',
				'AI agents tooling',
				'AI agents workflows'
			]
		},
		{
			id: 2,
			title: 'We Design',
			items: [
				'Tokenomics',
				'Governance systems',
				'Treasury management solutions',
				'Liquidity allocation strategies',
				'Protocol architectures'
			]
		}
	];

	const HIDDEN_EPSILON = 0.001;
	const CARD_STAGGER = 0.08;
	const CARD_PHASE_SPAN = 0.42;
	const CARD_LIFT_PX = 52;
	const CARD_OVERFLOW_ALLOWANCE_PX = CARD_LIFT_PX + 4;
	const CARD_TILT_DEG = 6;
	const CARD_START_SCALE = 0.965;

	function getCardProgress(index: number, scrubProgress: number) {
		const start = 0.18 + index * CARD_STAGGER;
		return smoothstep(clamp01((scrubProgress - start) / CARD_PHASE_SPAN));
	}

	function getLayerProgress(cardProgress: number, start: number, span: number) {
		return smoothstep(clamp01((cardProgress - start) / span));
	}

	let sectionProgress = $derived(clamp01(progress));
	let uiProgress = $derived(getUiProgress(sectionProgress));
	let headingUiProgress = $derived(uiProgress);
	let isSectionHidden = $derived(uiProgress <= HIDDEN_EPSILON);
	let headingRevealConfig = $derived({
		progress: headingUiProgress,
		duration: 0.58,
		stagger: 0.014
	});
</script>

<div class="services section__wrap">
	<Heading
		text={['Services']}
		sup="2"
		position="bottom"
		progress={sectionProgress}
		{headingRevealConfig}
		className="mobile-padded services-heading"
	/>

	<IconPlus bottom="1.2rem" left={['-1.68rem', '0']} desktopHide={true} hidden={isSectionHidden} />

	<div
		class="services__cards"
		style:--card-overflow-allowance={`${CARD_OVERFLOW_ALLOWANCE_PX}px`}
		style:pointer-events={uiProgress > 0.18 ? 'auto' : 'none'}
	>
		{#each SERVICES_CARDS as card, i (card.id)}
			{@const cardProgress = getCardProgress(i, uiProgress)}
			{@const titleProgress = getLayerProgress(cardProgress, 0.08, 0.7)}
			{@const listProgress = getLayerProgress(cardProgress, 0.2, 0.72)}
			{@const accentProgress = getLayerProgress(cardProgress, 0.14, 0.72)}
			{@const inverseProgress = 1 - cardProgress}
			<div
				class="services-card"
				style:--card-accent-progress={accentProgress}
				style:opacity={getLayerProgress(cardProgress, 0, 0.72)}
				style:transform={`perspective(900px) translate3d(0, ${inverseProgress * CARD_LIFT_PX}px, 0) rotateX(${inverseProgress * CARD_TILT_DEG}deg) scale(${CARD_START_SCALE + cardProgress * (1 - CARD_START_SCALE)})`}
				style:will-change={cardProgress > HIDDEN_EPSILON && cardProgress < 1 - HIDDEN_EPSILON
					? 'transform, opacity'
					: 'auto'}
			>
				<b
					class="services-card__title"
					style:opacity={titleProgress}
					style:transform={`translate3d(0, ${(1 - titleProgress) * 14}px, 0)`}
				>
					{card.title}
				</b>
				<ul
					class="services-card__list"
					style:opacity={listProgress}
					style:transform={`translate3d(0, ${(1 - listProgress) * 18}px, 0)`}
				>
					{#each card.items as item (item)}
						<li>{item}</li>
					{/each}
				</ul>
			</div>
		{/each}
	</div>
</div>

<style lang="scss">
	@use '$lib/styles/variables' as *;

	.services {
		width: 100%;
		position: relative;

		@media (min-width: 1025px) {
			margin-left: $offset-content;
		}

		/* H2 Large — shared oversized title (Daoism Systems / Services / Join our team). */
		:global(.services-heading) {
			@include breakpoint(desktop) {
				font-size: 104px;
			}

			@media (max-width: 1110px) and (min-width: 550px) {
				font-size: 96px;
			}
		}

		&__cards {
			--services-title-space: 3rem;
			--services-cards-gap: 1.5rem;

			display: none;
			position: absolute;
			left: 0;
			bottom: calc(
				var(--services-title-space) + var(--services-cards-gap) -
					var(--card-overflow-allowance, 56px)
			);
			width: 100%;
			flex-direction: row;
			gap: 0.625rem;
			padding-inline: 0.625rem;
			padding-bottom: var(--card-overflow-allowance, 56px);
			overflow-x: auto;
			overflow-y: hidden;
			scroll-snap-type: x mandatory;
			-webkit-overflow-scrolling: touch;
			scrollbar-width: none;
			contain: layout style;

			@media (min-width: 550px) and (max-width: 1110px) {
				--services-title-space: 5.75rem;
			}

			&::-webkit-scrollbar {
				display: none;
			}

			@include breakpoint(not-desktop) {
				display: flex;
			}
		}

		&-card {
			flex: 0 0 auto;
			width: 50%;
			padding: 0.75rem 0.75rem 1.25rem;
			background:
				linear-gradient(145deg, rgba(255, 255, 255, 0.065), transparent 42%),
				$color-grey-600;
			box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.045);
			border-radius: 0.75rem;
			scroll-snap-align: start;
			user-select: none;
			-webkit-touch-callout: none;
			display: flex;
			flex-direction: column;
			gap: 8.5px;
			text-align: left;
			position: relative;
			isolation: isolate;
			contain: layout style paint;
			transform-origin: 50% 100%;
			backface-visibility: hidden;

			opacity: 0;
			transform: translateY(60px);

			@media (max-width: 768px) {
				width: calc(100% - 4.625rem);
				max-width: 21.25rem;
			}

			&__title {
				font-size: 15px;
				line-height: 1.2;
				font-weight: 400;
				color: #fff;
				word-spacing: $word-spacing;
				backface-visibility: hidden;
			}

			&__list {
				font-size: 12px;
				line-height: 1.5;
				color: $color-grey-500;
				word-spacing: $word-spacing;
				list-style: none;
				margin: 0;
				padding: 0;
				backface-visibility: hidden;

				li {
					position: relative;
					padding-left: 0.85rem;

					&::before {
						content: '';
						position: absolute;
						left: 0;
						top: 0.6em;
						width: 3px;
						height: 3px;
						border-radius: 50%;
						background: currentColor;
					}
				}
			}
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.services-card {
			transition: none !important;
			opacity: 1 !important;
			transform: none !important;

			&::before {
				opacity: 1 !important;
				transform: none !important;
			}

			&__title,
			&__list {
				opacity: 1 !important;
				transform: none !important;
			}
		}
	}
</style>
