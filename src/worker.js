// @ts-nocheck
const USERS_PREFIX = 'user:';
const SESSIONS_PREFIX = 'session:';

const encoder = new TextEncoder();

async function hashPassword(password) {
	const hashed = await crypto.subtle.digest('SHA-256', encoder.encode(password));
	return Array.from(new Uint8Array(hashed), (b) => b.toString(16).padStart(2, '0')).join('');
}

function generateToken() {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

const json = (data, init = {}) =>
	Response.json(data, {
		status: init.status ?? 200,
		headers: {
			'Cache-Control': 'no-store',
			...init.headers
		}
	});

const error = (message, status = 400) => json({ success: false, message }, { status });

export class MyDurableObject {
	constructor(state) {
		this.state = state;
	}

	async fetch(request) {
		const url = new URL(request.url);
		const { pathname, searchParams } = url;

		try {
			if (request.method === 'POST' && pathname === '/register') {
				return await this.handleRegister(request);
			}

			if (request.method === 'POST' && pathname === '/login') {
				return await this.handleLogin(request);
			}

			if (request.method === 'POST' && pathname === '/logout') {
				return await this.handleLogout(request);
			}

			if (request.method === 'GET' && pathname === '/session') {
				return await this.handleSession(searchParams);
			}

			return error('Endpoint not found', 404);
		} catch (err) {
			console.error('Durable Object error', err);
			return error('Internal server error', 500);
		}
	}

	async handleRegister(request) {
		const { username, password } = await this.readJson(request);

		if (!username || !password) {
			return error('Username and password are required');
		}

		const trimmedUsername = username.trim();
		if (!trimmedUsername) {
			return error('Username cannot be empty');
		}

		const userKey = `${USERS_PREFIX}${trimmedUsername}`;
		const existing = await this.state.storage.get(userKey);
		if (existing) {
			return error('Username already exists', 409);
		}

		const passwordHash = await hashPassword(password);
		await this.state.storage.put(userKey, {
			passwordHash,
			createdAt: Date.now()
		});

		return json({ success: true, message: 'Account created successfully.' }, { status: 201 });
	}

	async handleLogin(request) {
		const { username, password } = await this.readJson(request);

		if (!username || !password) {
			return error('Username and password are required');
		}

		const trimmedUsername = username.trim();
		const userKey = `${USERS_PREFIX}${trimmedUsername}`;
		const userRecord = await this.state.storage.get(userKey);
		if (!userRecord) {
			return error('Invalid credentials', 401);
		}

		const providedHash = await hashPassword(password);
		if (providedHash !== userRecord.passwordHash) {
			return error('Invalid credentials', 401);
		}

		const sessionToken = generateToken();
		await this.state.storage.put(`${SESSIONS_PREFIX}${sessionToken}`, {
			username: trimmedUsername,
			createdAt: Date.now()
		});

		return json({
			success: true,
			message: 'Login successful.',
			token: sessionToken,
			username: trimmedUsername
		});
	}

	async handleLogout(request) {
		const { token } = await this.readJson(request);
		if (!token) {
			return error('Session token is required');
		}

		await this.state.storage.delete(`${SESSIONS_PREFIX}${token}`);
		return json({ success: true, message: 'Logged out successfully.' });
	}

	async handleSession(searchParams) {
		const token = searchParams.get('token');
		if (!token) {
			return error('Session token is required', 400);
		}

		const session = await this.state.storage.get(`${SESSIONS_PREFIX}${token}`);
		if (!session) {
			return error('Session not found', 401);
		}

		return json({
			success: true,
			authenticated: true,
			username: session.username
		});
	}

	async readJson(request) {
		if (!request.headers.get('content-type')?.includes('application/json')) {
			throw new Error('Expected application/json content type');
		}
		return request.json();
	}
}

export const durableObjects = { MyDurableObject };
