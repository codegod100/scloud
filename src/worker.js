// @ts-nocheck
export class MyDurableObject {
	constructor(state) {
		this.state = state;
	}

	async fetch(request) {
		const url = new URL(request.url);

		if (request.method === 'POST' && url.pathname === '/store') {
			const data = await request.json();
			await this.state.storage.put('data', data);
			return new Response('Data stored', { status: 200 });
		}

		if (request.method === 'GET' && url.pathname === '/retrieve') {
			const data = await this.state.storage.get('data');
			return new Response(JSON.stringify(data), { status: 200 });
		}

		return new Response('Not found', { status: 404 });
	}
}

export const durableObjects = { MyDurableObject };
