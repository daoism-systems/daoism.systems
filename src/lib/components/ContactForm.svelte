<script lang="ts">
	import Button from '$lib/components/Button.svelte';
	import InputField from './InputField.svelte';
	import Textarea from './Textarea.svelte';

	let inputs = {
		name: '',
		email: '',
		message: ''
	};

	type FieldName = keyof typeof inputs;

	let errors: Record<FieldName, string> = {
		name: '',
		email: '',
		message: ''
	};

	let status: {
		submitted: boolean;
		submitting: boolean;
		info: { error: boolean; msg: string | null };
	} = {
		submitted: false,
		submitting: false,
		info: { error: false, msg: null }
	};

	let statusMessage = false;

	function handleStatusMessage() {
		statusMessage = true;
	}

	function validateField(field: FieldName, value: string): string {
		const trimmedValue = value.trim();

		if (!trimmedValue) {
			if (field === 'message') return '';
			if (field === 'name') return 'Alias is required';
			return `${field[0].toUpperCase()}${field.slice(1)} is required`;
		}

		if (field === 'email') {
			const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
			if (!emailPattern.test(trimmedValue) || trimmedValue.includes('..')) {
				return 'Enter a valid email address';
			}
		}

		if (field === 'name') {
			const aliasPattern = /^[A-Za-zÀ-ÖØ-öø-ÿ0-9._' -]+$/;
			if (trimmedValue.length < 2) return 'Alias must be at least 2 characters';
			if (!aliasPattern.test(trimmedValue))
				return 'Alias can contain only letters, numbers, dots, underscores, apostrophes, and hyphens';
		}

		return '';
	}

	function validateForm() {
		const nextErrors: Record<FieldName, string> = {
			name: validateField('name', inputs.name),
			email: validateField('email', inputs.email),
			message: validateField('message', inputs.message)
		};

		errors = nextErrors;

		return Object.values(nextErrors).every((error) => !error);
	}

	function handleOnChange(field?: FieldName) {
		status = {
			submitted: false,
			submitting: false,
			info: { error: false, msg: null }
		};
		statusMessage = false;

		if (field && errors[field]) {
			errors = { ...errors, [field]: validateField(field, inputs[field]) };
		}
	}

	async function handleOnSubmit(e: Event) {
		e.preventDefault();
		if (!validateForm()) {
			status = {
				submitted: false,
				submitting: false,
				info: { error: false, msg: null }
			};
			return;
		}

		status = { ...status, submitting: true };
		try {
			const res = await fetch('/api/send', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(inputs)
			});
			const text = await res.text();
			handleResponse(res.status, text);
		} catch (err) {
			handleResponse(500, 'Network error');
		}
	}

	function handleResponse(resStatus: number, msg: string) {
		if (resStatus === 200) {
			status = {
				submitted: true,
				submitting: false,
				info: { error: false, msg }
			};
			inputs = { name: '', email: '', message: '' };
			errors = { name: '', email: '', message: '' };
		} else {
			status = {
				...status,
				submitting: false,
				info: { error: true, msg }
			};
		}
	}
</script>

<form class="contact-form" novalidate on:submit|preventDefault={handleOnSubmit}>
	<div class="contact-form__row">
		<div class="contact-form__cell">
			<InputField
				type="text"
				label="Alias"
				placeholder="Satoshi Nakamoto"
				hasError={Boolean(errors.name)}
				bind:value={inputs.name}
				id="name"
				name="name"
				required={true}
				oninput={() => handleOnChange('name')}
			/>
			{#if errors.name}
				<p class="field-error">{errors.name}</p>
			{/if}
		</div>
		<div class="contact-form__cell">
			<InputField
				type="email"
				label="Email"
				placeholder="your@email.com"
				hasError={Boolean(errors.email)}
				bind:value={inputs.email}
				id="email"
				name="email"
				required={true}
				oninput={() => handleOnChange('email')}
			/>
			{#if errors.email}
				<p class="field-error">{errors.email}</p>
			{/if}
		</div>
	</div>
	<InputField
		type="text"
		label="Message"
		placeholder="Tell your wild idea"
		hasError={Boolean(errors.message)}
		bind:value={inputs.message}
		id="message"
		name="message"
		required={false}
		oninput={() => handleOnChange('message')}
	/>
	{#if errors.message}
		<p class="field-error">{errors.message}</p>
	{/if}
	<Button
		label={status.submitting ? 'Submitting...' : status.submitted ? 'Submitted' : 'Submit'}
		data-cursor-text-label={status.submitting ? 'Please wait...' : status.submitted ? 'Done' : 'Initialize handshake protocol'}
		color="red"
		type="submit"
		{...status.submitting ? { disabled: true } : {}}
	/>
	{#if status.info.error && status.info.msg}
		<div class="form-status error" class:hidden={statusMessage}>
			Error: {status.info.msg}
			<button type="button" on:click={handleStatusMessage}>✕</button>
		</div>
	{/if}
	{#if !status.info.error && status.info.msg}
		<div class="form-status success" class:hidden={statusMessage}>
			{status.info.msg}
			<button type="button" on:click={handleStatusMessage}>✕</button>
		</div>
	{/if}
</form>

<style lang="scss">
	@use '$lib/styles/variables' as *;

	.contact-form {
		display: flex;
		flex-direction: column;
		gap: 1rem;

		@media (min-width: 2245px) {
			gap: 1.5rem;
		}

		@include breakpoint(phone) {
			gap: 0.625rem;
		}

		&__row {
			display: flex;
			gap: 1rem;
			flex-wrap: nowrap;

			@media (min-width: 2245px) {
				gap: 1.5rem;
			}

			@include breakpoint(not-desktop) {
				flex-wrap: wrap;
			}

			@include breakpoint(phone) {
				gap: 0.625rem;
			}
		}

		&__cell {
			width: calc((100% - 1rem) / 2);
			display: flex;
			flex-direction: column;
			gap: 0.25rem;
			min-width: 0;

			@media (min-width: 2245px) {
				width: calc((100% - 1.5rem) / 2);
				gap: 0.4rem;
			}

			@include breakpoint(tablet) {
				width: calc(50% - 0.5rem);
			}

			@include breakpoint(phone) {
				width: 100%;
			}
		}
	}

	.field-error {
		color: #e64749;
		font-size: 0.75rem;
		word-spacing: $word-spacing;
		margin: 0 0 0 0.25rem;

		@media (min-width: 2245px) {
			font-size: 1rem;
			margin-left: 0.35rem;
		}
	}

	:global(.contact-form__row .contact-form__cell .input-field) {
		width: 100%;
	}

	@include breakpoint(phone) {
		:global(.contact-form .input-field) {
			gap: 0.18rem;
			padding: 0.48rem 0.75rem;
			min-height: 2.95rem;
		}

		:global(.contact-form .input-field label) {
			font-size: 0.72rem;
		}

		:global(.contact-form .input-field input) {
			font-size: 0.9rem;
			line-height: 1.2;
		}
	}

	@include breakpoint(small-phone) {
		:global(.contact-form .input-field) {
			padding: 0.42rem 0.65rem;
			min-height: 2.75rem;
		}

		:global(.contact-form .input-field label) {
			font-size: 0.68rem;
		}

		:global(.contact-form .input-field input) {
			font-size: 0.84rem;
		}
	}
</style>
