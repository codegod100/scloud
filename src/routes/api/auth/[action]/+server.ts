import type { RequestHandler } from '@sveltejs/kit';

const POST_ACTIONS = new Set(['register', 'login', 'logout']);
const SESSION_COOKIE = 'session_token';
const ONE_WEEK_SECONDS = 60 * 60 * 24 * 7;

function getDurableObjectStub(platform: App.Platform | undefined) {
	if (!platform?.env?.MY_DO) {
		return null;
	}

	const id = platform.env.MY_DO.idFromName('auth-instance');
	return platform.env.MY_DO.get(id);
}

function notFound() {
	return new Response('Not found', { status: 404 });
}

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

export const POST: RequestHandler = async ({ request, platform, params, cookies }) => {
	const action = (params as Record<string, string>).action?.toLowerCase();
	if (!action || !POST_ACTIONS.has(action)) {
		return notFound();
	}

	const stub = getDurableObjectStub(platform);
	if (!stub) {
		return new Response('Durable Object not available', { status: 500 });
	}

	let bodyText = await request.text();
	const url = new URL(request.url);

	if (action === 'logout') {
		let parsed = parseJson(bodyText) ?? {};
		if (parsed && typeof parsed === 'object' && !parsed.token) {
			const cookieToken = cookies.get(SESSION_COOKIE);
			if (cookieToken) {
				parsed.token = cookieToken;
				bodyText = JSON.stringify(parsed);
			}
		}
	}
	const doUrl = new URL(`https://durable-object/${action}`);

	const forwardRequest = new Request(doUrl, {
		method: 'POST',
		headers: new Headers(request.headers),
		body: bodyText
	});

	const upstreamResponse = await stub.fetch(forwardRequest);
	const responseText = await upstreamResponse.text();
	const payload = parseJson(responseText);
	const headers = new Headers(upstreamResponse.headers);
	headers.delete('content-length');
	if (!headers.has('content-type')) {
		headers.set('content-type', 'application/json');
	}
	headers.set('Cache-Control', 'no-store');

	if (action === 'login') {
		if (upstreamResponse.ok && payload?.token) {
			cookies.set(SESSION_COOKIE, payload.token, buildCookieOptions(url));
		} else {
			cookies.delete(SESSION_COOKIE, buildDeleteCookieOptions(url));
		}
	}

	if (action === 'logout' && upstreamResponse.ok) {
		cookies.delete(SESSION_COOKIE, buildDeleteCookieOptions(url));
	}

	const responseBody = payload !== null ? JSON.stringify(payload) : responseText;

	return new Response(responseBody, {
		status: upstreamResponse.status,
		headers
	});
};

export const GET: RequestHandler = async ({ request, platform, params, url, cookies }) => {
	const action = (params as Record<string, string>).action?.toLowerCase();
	if (action !== 'session') {
		return notFound();
	}

	const stub = getDurableObjectStub(platform);
	if (!stub) {
		return new Response('Durable Object not available', { status: 500 });
	}

	const token = url.searchParams.get('token') ?? cookies.get(SESSION_COOKIE);
	if (!token) {
		return new Response(JSON.stringify({ success: false, message: 'Session token is required' }), {
			status: 400,
			headers: {
				'Content-Type': 'application/json',
				'Cache-Control': 'no-store'
			}
		});
	}

	const doUrl = new URL(`https://durable-object/${action}`);
	doUrl.searchParams.set('token', token);
	const forwardRequest = new Request(doUrl, {
		method: 'GET',
		headers: new Headers(request.headers)
	});

	const upstreamResponse = await stub.fetch(forwardRequest);
	const responseText = await upstreamResponse.text();
	const payload = parseJson(responseText);
	const headers = new Headers(upstreamResponse.headers);
	headers.delete('content-length');
	headers.set('Cache-Control', 'no-store');
	if (!headers.has('content-type')) {
		headers.set('content-type', 'application/json');
	}

	const requestUrl = new URL(request.url);
	if (upstreamResponse.ok && payload?.success !== false && payload?.profile) {
		cookies.set(SESSION_COOKIE, token, buildCookieOptions(requestUrl));
		if (payload && typeof payload === 'object') {
			(payload as Record<string, unknown>).token = token;
		}
	} else if (upstreamResponse.status === 401) {
		cookies.delete(SESSION_COOKIE, buildDeleteCookieOptions(requestUrl));
	}

	const responseBody = payload !== null ? JSON.stringify(payload) : responseText;

	return new Response(responseBody, {
		status: upstreamResponse.status,
		headers
	});
};
