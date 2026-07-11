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

	function getCardProgress(index: number, scrubProgress: number) {
		const start = 0.18 + index * CARD_STAGGER;
		return smoothstep(clamp01((scrubProgress - start) / CARD_PHASE_SPAN));
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

	<div class="services__cards" style:pointer-events={uiProgress > 0.18 ? 'auto' : 'none'}>
		{#each SERVICES_CARDS as card, i (card.id)}
			{@const cardProgress = getCardProgress(i, uiProgress)}
			<div
				class="services-card"
				style:opacity={cardProgress}
				style:transform={`translate3d(0, ${(1 - cardProgress) * 56}px, 0)`}
			>
				<b class="services-card__title">{card.title}</b>
				<ul class="services-card__list">
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

		@include breakpoint(desktop) {
			margin-left: $offset-content;
		}

		/* H2 Large — shared oversized title (Daoism Systems / Services / Join our team). */
		:global(.services-heading) {
			@include breakpoint(desktop) {
				font-size: 104px;
			}
		}

		&__cards {
			display: none;
			position: absolute;
			left: 0;
			bottom: 10%;
			width: 100%;
			flex-direction: row;
			gap: 0.625rem;
			padding-inline: 0.625rem;
			overflow-x: auto;
			overflow-y: hidden;
			scroll-snap-type: x mandatory;
			-webkit-overflow-scrolling: touch;
			scrollbar-width: none;
			contain: layout style;

			&::-webkit-scrollbar {
				display: none;
			}

			@include breakpoint(not-desktop) {
				display: flex;
			}
		}

		&-card {
			flex: 0 0 auto;
			width: calc(100% - 4.625rem);
			max-width: 21.25rem;
			padding: 0.75rem 0.75rem 1.25rem;
			background: $color-grey-600;
			border-radius: 0.75rem;
			scroll-snap-align: start;
			user-select: none;
			-webkit-touch-callout: none;
			display: flex;
			flex-direction: column;
			gap: 8.5px;
			text-align: left;

			opacity: 0;
			transform: translateY(60px);
			will-change: transform, opacity;

			&__title {
				font-size: 15px;
				line-height: 1.2;
				font-weight: 400;
				color: #fff;
				word-spacing: $word-spacing;
			}

			&__list {
				font-size: 12px;
				line-height: 1.5;
				color: $color-grey-500;
				word-spacing: $word-spacing;
				list-style: none;
				margin: 0;
				padding: 0;
			}
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.services-card {
			transition: none !important;
			opacity: 1 !important;
			transform: none !important;
		}
	}
</style>
