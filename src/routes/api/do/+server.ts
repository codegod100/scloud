import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, platform }) => {
	if (!platform?.env?.MY_DO) {
		return new Response('Durable Object not available', { status: 500 });
	}

	const id = platform.env.MY_DO.idFromName('my-do-instance');
	const stub = platform.env.MY_DO.get(id);

	// Create a new request with the path set to /store for the DO
	const doUrl = new URL('http://dummy/store');
	const doRequest = new Request(doUrl, request);

	const response = await stub.fetch(doRequest);

	return response;
};

export const GET: RequestHandler = async ({ request, platform }) => {
	if (!platform?.env?.MY_DO) {
		return new Response('Durable Object not available', { status: 500 });
	}

	const id = platform.env.MY_DO.idFromName('my-do-instance');
	const stub = platform.env.MY_DO.get(id);

	// Create a new request with the path set to /retrieve for the DO
	const doUrl = new URL('http://dummy/retrieve');
	const doRequest = new Request(doUrl, request);

	const response = await stub.fetch(doRequest);

	return response;
};