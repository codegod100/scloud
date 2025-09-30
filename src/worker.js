// @ts-nocheck
const USERS_PREFIX = 'user:';
const SESSIONS_PREFIX = 'session:';

const PROVIDER_LOCAL = 'local';
const PROVIDER_GOOGLE = 'google';

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

const buildUserKey = (provider, identifier) => `${USERS_PREFIX}${provider}:${identifier}`;

const getLegacyLocalKey = (username) => `${USERS_PREFIX}${username}`;

export class MyDurableObject {
	constructor(state, env) {
		this.state = state;
		this.env = env;
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

			if (request.method === 'POST' && pathname === '/google-login') {
				return await this.handleGoogleLogin(request);
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

		const userKey = buildUserKey(PROVIDER_LOCAL, trimmedUsername);
		const existing =
			(await this.state.storage.get(userKey)) ?? (await this.state.storage.get(getLegacyLocalKey(trimmedUsername)));
		if (existing) {
			return error('Username already exists', 409);
		}

		const passwordHash = await hashPassword(password);
		await this.state.storage.put(userKey, {
			provider: PROVIDER_LOCAL,
			username: trimmedUsername,
			passwordHash,
			createdAt: Date.now()
		});

		// Clean up any legacy key if it exists.
		await this.state.storage.delete(getLegacyLocalKey(trimmedUsername));

		return json({ success: true, message: 'Account created successfully.' }, { status: 201 });
	}

	async handleLogin(request) {
		const { username, password } = await this.readJson(request);

		if (!username || !password) {
			return error('Username and password are required');
		}

		const trimmedUsername = username.trim();
		const userKey = buildUserKey(PROVIDER_LOCAL, trimmedUsername);
		const userRecord =
			(await this.state.storage.get(userKey)) ?? (await this.state.storage.get(getLegacyLocalKey(trimmedUsername)));
		if (!userRecord) {
			return error('Invalid credentials', 401);
		}

		const providedHash = await hashPassword(password);
		if (providedHash !== userRecord.passwordHash) {
			return error('Invalid credentials', 401);
		}

		const session = await this.createSession({
			provider: PROVIDER_LOCAL,
			userId: trimmedUsername,
			username: trimmedUsername,
			displayName: trimmedUsername,
			createdAt: Date.now()
		});

		return json({
			success: true,
			message: 'Login successful.',
			token: session.token,
			username: session.payload.displayName,
			profile: session.payload
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
			username: session.displayName ?? session.username ?? '',
			profile: session
		});
	}

	async handleGoogleLogin(request) {
		const { credential } = await this.readJson(request);

		if (!credential) {
			return error('Google credential is required');
		}

		const tokenInfo = await this.verifyGoogleCredential(credential);
		if (!tokenInfo) {
			return error('Unable to verify Google credential', 401);
		}

		const sub = tokenInfo.sub;
		if (!sub) {
			return error('Google token is missing subject identifier', 401);
		}

		const emailVerified = tokenInfo.email_verified === true || tokenInfo.email_verified === 'true';
		if (!emailVerified) {
			return error('Google account email is not verified', 403);
		}

		const email = tokenInfo.email;
		const displayName = tokenInfo.name || email || 'Google User';
		const picture = tokenInfo.picture;

		const userKey = buildUserKey(PROVIDER_GOOGLE, sub);
		await this.state.storage.put(userKey, {
			provider: PROVIDER_GOOGLE,
			userId: sub,
			email,
			displayName,
			picture,
			lastLoginAt: Date.now()
		});

		const session = await this.createSession({
			provider: PROVIDER_GOOGLE,
			userId: sub,
			username: email,
			displayName,
			email,
			picture,
			createdAt: Date.now()
		});

		return json({
			success: true,
			message: 'Google login successful.',
			token: session.token,
			username: session.payload.displayName,
			email,
			profile: session.payload
		});
	}

	async createSession(payload) {
		const sessionToken = generateToken();
		await this.state.storage.put(`${SESSIONS_PREFIX}${sessionToken}`, payload);

		return {
			token: sessionToken,
			payload
		};
	}

	async verifyGoogleCredential(credential) {
		const endpoint = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`;
		const response = await fetch(endpoint, { cf: { cacheEverything: false } });

		if (!response.ok) {
			console.warn('Google token verification failed with status', response.status);
			return null;
		}

		const tokenInfo = await response.json();
		const expectedClientId = this.env?.GOOGLE_CLIENT_ID;

		if (expectedClientId && tokenInfo.aud !== expectedClientId) {
			console.warn('Google token audience mismatch', tokenInfo.aud);
			return null;
		}

		return tokenInfo;
	}

	async readJson(request) {
		if (!request.headers.get('content-type')?.includes('application/json')) {
			throw new Error('Expected application/json content type');
		}
		return request.json();
	}
}

export const durableObjects = { MyDurableObject };
