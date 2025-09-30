import type { RequestHandler } from '@sveltejs/kit';

function getDurableObjectStub(platform: App.Platform | undefined) {
	if (!platform?.env?.MY_DO) {
		return null;
	}

	const id = platform.env.MY_DO.idFromName('auth-instance');
	return platform.env.MY_DO.get(id);
}

function jsonResponse(payload: Record<string, unknown>, status = 200) {
	return new Response(JSON.stringify(payload), {
		status,
		headers: {
			'Content-Type': 'application/json',
			'Cache-Control': 'no-store'
		}
	});
}

const SESSION_COOKIE = 'session_token';
const ONE_WEEK_SECONDS = 60 * 60 * 24 * 7;

function parseJson(text: string | null) {
	if (!text) return null;
	try {
		return JSON.parse(text);
	} catch (error) {
		return null;
	}
}

function buildCookieOptions(url: URL) {
	const secure = url.protocol === 'https:';
	return {
		path: '/',
		httpOnly: true,
		secure,
		sameSite: 'lax' as const,
		maxAge: ONE_WEEK_SECONDS
	};
}

function buildDeleteCookieOptions(url: URL) {
	const secure = url.protocol === 'https:';
	return {
		path: '/',
		httpOnly: true,
		secure,
		sameSite: 'lax' as const
	};
}

export const POST: RequestHandler = async ({ request, platform, cookies }) => {
	const stub = getDurableObjectStub(platform);
	if (!stub) {
		return jsonResponse({ success: false, message: 'Authentication service is unavailable.' }, 500);
	}

	let credential: string | undefined;

	try {
		const body = (await request.json()) as { credential?: string };
		credential = body.credential;
	} catch (error) {
		return jsonResponse({ success: false, message: 'Invalid request payload.' }, 400);
	}

	if (!credential) {
		return jsonResponse({ success: false, message: 'Google credential is required.' }, 400);
	}

	const upstreamRequest = new Request('https://durable-object/google-login', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ credential })
	});

	const upstreamResponse = await stub.fetch(upstreamRequest);
	const responseText = await upstreamResponse.text();
	const payload = parseJson(responseText);
	const headers = new Headers(upstreamResponse.headers);
	headers.delete('content-length');
	headers.set('Cache-Control', 'no-store');
	if (!headers.has('content-type')) {
		headers.set('content-type', 'application/json');
	}

	const url = new URL(request.url);
	if (upstreamResponse.ok && payload?.token) {
		cookies.set(SESSION_COOKIE, payload.token, buildCookieOptions(url));
	} else {
		cookies.delete(SESSION_COOKIE, buildDeleteCookieOptions(url));
	}

	return new Response(responseText, {
		status: upstreamResponse.status,
		headers
	});
};
