import type { RequestHandler } from '@sveltejs/kit';
import { Resend } from 'resend';
import { env } from '$env/dynamic/private';

const RESEND_API_KEY = env.RESEND_API_KEY;
const TO_EMAIL = env.TO_EMAIL;

// Optional. Defaults to Resend's shared onboarding sender so the form works before a
// domain is verified — note that sender only delivers to the Resend account owner's
// address. For production from your own domain, verify it in Resend and set FROM_EMAIL.
const FROM_EMAIL = env.FROM_EMAIL || 'onboarding@resend.dev';

function getRequiredConfig() {
	if (!RESEND_API_KEY || !TO_EMAIL) {
		return {
			ok: false as const,
			message: 'Email service is not configured. Set RESEND_API_KEY and TO_EMAIL.'
		};
	}

	return { ok: true as const };
}

function getResendMessage(error: unknown): string {
	if (typeof error === 'object' && error && 'message' in error) {
		const message = (error as { message?: string }).message;
		if (message) {
			return message;
		}
	}

	if (error instanceof Error && error.message) {
		return error.message;
	}

	return 'Unknown email provider error.';
}

export const POST: RequestHandler = async ({ request }) => {
	const config = getRequiredConfig();
	if (!config.ok) {
		return new Response(config.message, { status: 500 });
	}

	const resend = new Resend(RESEND_API_KEY as string);

	try {
		const { name, email, message } = (await request.json()) as {
			name?: string;
			email?: string;
			message?: string;
		};

		if (!name || !email) {
			return new Response('Name and email are required.', { status: 400 });
		}

		// Resend reports API-level failures via the returned `error` rather than throwing;
		// only network/unexpected errors reach the catch below.
		const { error } = await resend.emails.send({
			to: TO_EMAIL as string,
			from: FROM_EMAIL,
			replyTo: email,
			subject: 'Contact',
			html: `<p><strong>name: </strong>${name}</p>
				<p><strong>email: </strong>${email}</p>
				<p><strong>message: </strong>${message ?? ''}</p>`
		});

		if (error) {
			const providerMessage = getResendMessage(error);
			console.error('Email send failed:', providerMessage);
			return new Response(`Message not sent: ${providerMessage}`, { status: 502 });
		}

		return new Response('Message sent successfully.', { status: 200 });
	} catch (error) {
		const providerMessage = getResendMessage(error);
		console.error('Email send failed:', providerMessage);
		return new Response(`Message not sent: ${providerMessage}`, { status: 502 });
	}
};
