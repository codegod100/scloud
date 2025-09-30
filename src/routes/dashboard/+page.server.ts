// @ts-nocheck
import { redirect } from '@sveltejs/kit';

const SESSION_ENDPOINT = '/api/auth/session';

export const load = async ({ cookies, fetch, url }) => {
	const token = cookies.get('session_token');
	if (!token) {
		throw redirect(302, `/?redirect=${encodeURIComponent(url.pathname)}`);
	}

	const response = await fetch(SESSION_ENDPOINT);
	const text = await response.text();

	let payload: any = null;
	if (text) {
		try {
			payload = JSON.parse(text);
		} catch (error) {
			payload = null;
		}
	}

	if (!response.ok || !payload?.success) {
		cookies.delete('session_token', { path: '/' });
		throw redirect(302, '/');
	}

	return {
		session: payload
	};
};
