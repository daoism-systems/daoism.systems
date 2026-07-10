<script lang="ts">
	const lastUpdated = '05.06.2026';
</script>

<svelte:head>
	<title>Privacy Policy — Daoism Systems</title>
	<meta name="description" content="How Daoism Systems collects, uses, and protects personal information." />
</svelte:head>

<main class="privacy">
	<div class="privacy__wrap">
		<a class="privacy__back" href="/">← Back to home</a>

		<header class="privacy__head">
			<h1>Privacy Policy</h1>
			<p class="privacy__org">Daoism Systems</p>
			<p class="privacy__updated">Last updated: {lastUpdated}</p>
		</header>

		<section class="privacy__section">
			<h2>Introduction</h2>
			<p>
				This Privacy Policy explains how Daoism Systems (“we”, “us”, or “our”) collects, uses, and
				protects personal information submitted through our website.
			</p>
			<p>
				We keep our data collection minimal. We do not use analytics tracking tools, advertising
				trackers, or behavioral profiling on our website.
			</p>
		</section>

		<section class="privacy__section">
			<h2>1. Information we collect</h2>
			<p>When you contact us through the website form, we may collect the following information:</p>
			<ul>
				<li>Full name</li>
				<li>Email address</li>
				<li>Phone number</li>
				<li>Message content</li>
			</ul>
			<p>We only collect the information you choose to provide through the form.</p>
		</section>

		<section class="privacy__section">
			<h2>2. How we use your information</h2>
			<p>We use the information submitted through the contact form to:</p>
			<ul>
				<li>Respond to your inquiry</li>
				<li>Communicate with you about your request</li>
				<li>Provide information about our services, if requested</li>
				<li>Keep basic internal records related to communication</li>
			</ul>
			<p>
				We do not use this information for automated decision-making, profiling, advertising, or
				analytics.
			</p>
		</section>

		<section class="privacy__section">
			<h2>3. Legal basis for processing</h2>
			<p>
				Where applicable under data protection laws, we process your personal information based on
				our legitimate interest in responding to inquiries and managing business communication, or
				based on your request before entering into a potential business relationship.
			</p>
		</section>

		<section class="privacy__section">
			<h2>4. Analytics and cookies</h2>
			<p>We do not use analytics tools on our website.</p>
			<p>
				We do not use tracking cookies, advertising cookies, or third-party analytics cookies. If our
				website uses only technically necessary cookies, they are used solely to make the website
				function properly.
			</p>
		</section>

		<section class="privacy__section">
			<h2>5. Sharing of information</h2>
			<p>We do not sell, rent, or trade your personal information.</p>
			<p>We may share your information only when necessary with:</p>
			<ul>
				<li>Internal team members who need it to respond to your inquiry</li>
				<li>Service providers that help us operate the website, email, hosting, or communication tools</li>
				<li>Authorities, if required by law</li>
			</ul>
			<p>
				Any service providers we use are expected to handle personal information securely and only
				for the purpose of providing their services.
			</p>
		</section>

		<section class="privacy__section">
			<h2>6. Data retention</h2>
			<p>
				We keep contact form submissions only for as long as necessary to respond to your inquiry
				and manage related communication.
			</p>
			<p>
				If no business relationship follows from your inquiry, we will not keep your personal
				information longer than reasonably necessary, unless we are required to retain it for legal,
				administrative, or security reasons.
			</p>
		</section>

		<section class="privacy__section">
			<h2>7. International transfers</h2>
			<p>
				Depending on the tools and service providers we use, your information may be processed in
				countries outside your country of residence.
			</p>
			<p>
				Where required, we rely on appropriate safeguards for international data transfers, such as
				contractual protections or other legally recognized mechanisms.
			</p>
		</section>

		<section class="privacy__section">
			<h2>8. Security</h2>
			<p>
				We take reasonable technical and organizational measures to protect personal information from
				unauthorized access, loss, misuse, alteration, or disclosure.
			</p>
			<p>
				However, no method of online transmission or electronic storage is completely secure, so we
				cannot guarantee absolute security.
			</p>
		</section>

		<section class="privacy__section">
			<h2>9. Your rights</h2>
			<p>
				Depending on your location and applicable data protection laws, you may have the right to:
			</p>
			<ul>
				<li>Request access to the personal information we hold about you</li>
				<li>Request correction of inaccurate information</li>
				<li>Request deletion of your information</li>
				<li>Object to or restrict certain processing</li>
				<li>Request a copy of your information</li>
				<li>Withdraw consent, where processing is based on consent</li>
				<li>Lodge a complaint with a data protection authority</li>
			</ul>
		</section>

		<section class="privacy__section">
			<h2>10. Changes to this Privacy Policy</h2>
			<p>
				We may update this Privacy Policy from time to time. The updated version will be published on
				this page with a revised “Last updated” date.
			</p>
		</section>
	</div>
</main>

<style lang="scss">
	@use '$lib/styles/variables' as *;

	.privacy {
		// Own the scroll in a fixed, self-contained viewport — the global
		// site runtime leaves <html>/<body> at overflow:hidden while driving
		// the home page through its own fixed wrapper, so a plain document-flow
		// page can't scroll reliably after navigation. Mirrors .page-scroll-wrapper.
		position: fixed;
		inset: 0;
		overflow-y: auto;
		overflow-x: hidden;
		-webkit-overflow-scrolling: touch;
		overscroll-behavior: contain;
		background: #000;
		color: #fff;
		font-family: $font-main;
		font-weight: 300;
		// Legal copy needs normal spacing + selectable text, overriding the global
		// body rules (word-spacing: $word-spacing; user-select: none).
		word-spacing: normal;
		user-select: text;
		-webkit-user-select: text;
		padding: 6rem 1.2rem 8rem;

		@include breakpoint(not-desktop) {
			padding: 4.5rem 1.25rem 6rem;
		}
	}

	.privacy__wrap {
		max-width: 60rem;
		margin: 0 auto;
	}

	.privacy__back {
		display: inline-block;
		margin-bottom: 3rem;
		font-size: 0.85rem;
		letter-spacing: 0.04em;
		color: $color-grey-300;
		transition: color 0.25s ease;

		@media (hover: hover) and (pointer: fine) {
			&:hover {
				color: #fff;
			}
		}
	}

	.privacy__head {
		margin-bottom: 3.5rem;
	}

	h1 {
		font-size: clamp(2rem, 6vw, 3.5rem);
		line-height: 1.05;
		color: #fff;
		margin: 0 0 1rem;
	}

	.privacy__org {
		font-size: 1.1rem;
		color: $color-grey-300;
		margin: 0 0 0.35rem;
		letter-spacing: 0.02em;
	}

	.privacy__updated {
		font-size: 0.85rem;
		color: $color-grey-100;
		margin: 0;
	}

	.privacy__section {
		margin-bottom: 2.75rem;

		&:last-child {
			margin-bottom: 0;
		}
	}

	h2 {
		font-size: clamp(1.1rem, 2.5vw, 1.6rem);
		line-height: 1.15;
		color: #fff;
		margin: 0 0 1rem;
	}

	p {
		font-size: 1rem;
		line-height: 1.7;
		color: rgba(255, 255, 255, 0.78);
		margin: 0 0 1rem;

		&:last-child {
			margin-bottom: 0;
		}
	}

	ul {
		list-style: none;
		margin: 0 0 1rem;
		padding: 0;
	}

	li {
		position: relative;
		padding-left: 1.4rem;
		font-size: 1rem;
		line-height: 1.6;
		color: rgba(255, 255, 255, 0.78);
		margin-bottom: 0.5rem;

		&::before {
			content: '';
			position: absolute;
			left: 0;
			top: 0.65em;
			width: 0.4rem;
			height: 0.4rem;
			background: $color-red;
			border-radius: 50%;
		}

		&:last-child {
			margin-bottom: 0;
		}
	}
</style>
