import type { RequestHandler } from '@sveltejs/kit';
import sgMail from '@sendgrid/mail';
import { env } from '$env/dynamic/private';

const SG_API_KEY = env.SG_API_KEY;
const FROM_EMAIL = env.FROM_EMAIL;
const TO_EMAIL = env.TO_EMAIL;

function getRequiredConfig() {
	if (!SG_API_KEY || !FROM_EMAIL || !TO_EMAIL) {
		return {
			ok: false as const,
			message: 'Email service is not configured. Set SG_API_KEY, FROM_EMAIL, and TO_EMAIL.'
		};
	}

	return { ok: true as const };
}

function getSendgridMessage(error: unknown): string {
	if (typeof error === 'object' && error && 'response' in error) {
		const response = (error as { response?: { body?: { errors?: Array<{ message?: string }> } } }).response;
		const message = response?.body?.errors?.[0]?.message;
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

	sgMail.setApiKey(SG_API_KEY as string);

	try {
		const { name, email, message, phone } = (await request.json()) as {
			name?: string;
			email?: string;
			message?: string;
			phone?: string;
		};

		if (!name || !email || !phone) {
			return new Response('Name, email, and phone are required.', { status: 400 });
		}

		await sgMail.send({
			to: TO_EMAIL as string,
			from: FROM_EMAIL as string,
			replyTo: email,
			subject: 'Contact',
			html: `<p><strong>name: </strong>${name}</p>
				<p><strong>email: </strong>${email}</p>
				<p><strong>phone: </strong>${phone}</p>
				<p><strong>message: </strong>${message ?? ''}</p>`
		});

		return new Response('Message sent successfully.', { status: 200 });
	} catch (error) {
		const providerMessage = getSendgridMessage(error);
		console.error('Email send failed:', providerMessage);
		return new Response(`Message not sent: ${providerMessage}`, { status: 502 });
	}
};
