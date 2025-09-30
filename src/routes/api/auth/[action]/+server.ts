import type { RequestHandler } from '@sveltejs/kit';

const POST_ACTIONS = new Set(['register', 'login', 'logout']);

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

export const POST: RequestHandler = async ({ request, platform, params }) => {
	const action = (params as Record<string, string>).action?.toLowerCase();
	if (!action || !POST_ACTIONS.has(action)) {
		return notFound();
	}

	const stub = getDurableObjectStub(platform);
	if (!stub) {
		return new Response('Durable Object not available', { status: 500 });
	}

	const bodyText = await request.text();
	const doUrl = new URL(`https://durable-object/${action}`);

	const forwardRequest = new Request(doUrl, {
		method: 'POST',
		headers: new Headers(request.headers),
		body: bodyText
	});

	return stub.fetch(forwardRequest);
};

export const GET: RequestHandler = async ({ request, platform, params, url }) => {
	const action = (params as Record<string, string>).action?.toLowerCase();
	if (action !== 'session') {
		return notFound();
	}

	const stub = getDurableObjectStub(platform);
	if (!stub) {
		return new Response('Durable Object not available', { status: 500 });
	}

	const doUrl = new URL(`https://durable-object/${action}${url.search}`);
	const forwardRequest = new Request(doUrl, {
		method: 'GET',
		headers: new Headers(request.headers)
	});

	return stub.fetch(forwardRequest);
};
