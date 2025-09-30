import type { RequestHandler } from '@sveltejs/kit';

const message = JSON.stringify({
	success: false,
	message: 'This endpoint has moved. Use /api/auth/<action> instead.'
});

const responseInit = {
	status: 410,
	headers: {
		'Content-Type': 'application/json',
		'Cache-Control': 'no-store'
	}
} as const satisfies ResponseInit;

export const GET: RequestHandler = () => new Response(message, responseInit);

export const POST: RequestHandler = () => new Response(message, responseInit);