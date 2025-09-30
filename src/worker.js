// @ts-nocheck
const USERS_PREFIX = 'user:';
const SESSIONS_PREFIX = 'session:';

const PROVIDER_LOCAL = 'local';
const PROVIDER_GOOGLE = 'google';

const MAX_DISPLAY_NAME_LENGTH = 64;
const MAX_BIO_LENGTH = 400;

const getSessionKey = (token) => `${SESSIONS_PREFIX}${token}`;

const encoder = new TextEncoder();

const clampLength = (value, max) => (value.length > max ? value.slice(0, max) : value);

const toOptionalString = (value) => (value == null ? '' : String(value));

function sanitizeDisplayName(value, fallback) {
	const base = toOptionalString(value).trim();
	if (!base) {
		const fallbackValue = toOptionalString(fallback).trim() || 'User';
		return clampLength(fallbackValue, MAX_DISPLAY_NAME_LENGTH);
	}
	return clampLength(base, MAX_DISPLAY_NAME_LENGTH);
}

function sanitizeBio(value) {
	const base = toOptionalString(value).trim();
	return clampLength(base, MAX_BIO_LENGTH);
}

function buildProfile(provider, userId, record = {}, session = {}) {
	const username = session.username ?? record.username ?? userId ?? '';
	const displayName = sanitizeDisplayName(record.displayName ?? session.displayName ?? username, username);
	const email = record.email ?? session.email;
	const picture = record.picture ?? session.picture;
	const bio = sanitizeBio(record.bio ?? session.bio ?? '');

	const profile = {
		provider,
		userId,
		username,
		displayName,
		bio
	};

	if (email) {
		profile.email = email;
	}

	if (picture) {
		profile.picture = picture;
	}

	return profile;
}

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

			if (request.method === 'POST' && pathname === '/profile') {
				return await this.handleProfileUpdate(request);
			}

			if (request.method === 'GET' && pathname === '/session') {
				return await this.handleSession(searchParams);
			}

			if (request.method === 'GET' && pathname === '/profile') {
				return await this.handleProfileGet(searchParams);
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
		const displayName = sanitizeDisplayName(trimmedUsername, trimmedUsername);
		await this.state.storage.put(userKey, {
			provider: PROVIDER_LOCAL,
			username: trimmedUsername,
			displayName,
			bio: '',
			passwordHash,
			createdAt: Date.now(),
			updatedAt: Date.now()
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

		userRecord.displayName = sanitizeDisplayName(userRecord.displayName, trimmedUsername);
		userRecord.bio = sanitizeBio(userRecord.bio ?? '');
		userRecord.lastLoginAt = Date.now();
		userRecord.updatedAt = Date.now();
		await this.state.storage.put(userKey, userRecord);

		const profile = buildProfile(PROVIDER_LOCAL, trimmedUsername, userRecord, {
			username: trimmedUsername
		});

		const session = await this.createSession({
			...profile,
			authenticatedAt: Date.now()
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

		const session = await this.getSession(token);
		if (!session) {
			return error('Session not found', 401);
		}

		const provider = session.provider ?? PROVIDER_LOCAL;
		const userId = session.userId ?? session.username;
		const userRecord = userId ? await this.getUserRecord(provider, userId) : null;
		const profile = buildProfile(provider, userId, userRecord ?? {}, session);

		if (
			session.displayName !== profile.displayName ||
			sanitizeBio(session.bio ?? '') !== profile.bio ||
			session.username !== profile.username ||
			session.email !== profile.email ||
			session.picture !== profile.picture
		) {
			await this.updateSession(token, profile);
		}

		return json({
			success: true,
			authenticated: true,
			username: profile.displayName || profile.username || '',
			profile,
			token
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
		const userKey = buildUserKey(PROVIDER_GOOGLE, sub);
		const existingRecord = await this.state.storage.get(userKey);

		const displayName = sanitizeDisplayName(
			existingRecord?.displayName ?? tokenInfo.name,
			email || 'Google User'
		);
		const picture = tokenInfo.picture ?? existingRecord?.picture;
		const bio = sanitizeBio(existingRecord?.bio ?? '');

		const userRecord = {
			provider: PROVIDER_GOOGLE,
			userId: sub,
			email,
			displayName,
			picture,
			bio,
			lastLoginAt: Date.now(),
			updatedAt: Date.now()
		};

		await this.state.storage.put(userKey, {
			...existingRecord,
			...userRecord
		});

		const profile = buildProfile(PROVIDER_GOOGLE, sub, userRecord, {
			username: email,
			email,
			picture
		});

		const session = await this.createSession({
			...profile,
			authenticatedAt: Date.now()
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
		const now = Date.now();
		const usernameFallback = payload.username ?? payload.userId ?? '';
		const displayName = sanitizeDisplayName(payload.displayName, usernameFallback);
		const bio = sanitizeBio(payload.bio ?? '');
		const provider = payload.provider ?? PROVIDER_LOCAL;
		const userId = payload.userId ?? usernameFallback;

		const sessionPayload = {
			provider,
			userId,
			username: usernameFallback,
			displayName,
			bio,
			authenticatedAt: payload.authenticatedAt ?? now,
			createdAt: payload.createdAt ?? now,
			updatedAt: now
		};

		if (payload.email) {
			sessionPayload.email = payload.email;
		}

		if (payload.picture) {
			sessionPayload.picture = payload.picture;
		}

		await this.state.storage.put(getSessionKey(sessionToken), sessionPayload);

		return {
			token: sessionToken,
			payload: sessionPayload
		};
	}

	async getSession(token) {
		if (!token) {
			return null;
		}
		return this.state.storage.get(getSessionKey(token));
	}

	async updateSession(token, updates) {
		const key = getSessionKey(token);
		const session = await this.state.storage.get(key);
		if (!session) {
			return null;
		}

		const merged = { ...session };

		if (updates.provider) {
			merged.provider = updates.provider;
		}

		if (updates.userId) {
			merged.userId = updates.userId;
		}

		if (updates.username) {
			const username = toOptionalString(updates.username).trim();
			if (username) {
				merged.username = username;
			}
		}

		if (updates.displayName !== undefined) {
			merged.displayName = sanitizeDisplayName(updates.displayName, merged.username ?? merged.displayName ?? 'User');
		}

		if (updates.bio !== undefined) {
			merged.bio = sanitizeBio(updates.bio);
		}

		if (updates.email !== undefined) {
			if (updates.email) {
				merged.email = updates.email;
			} else {
				delete merged.email;
			}
		}

		if (updates.picture !== undefined) {
			if (updates.picture) {
				merged.picture = updates.picture;
			} else {
				delete merged.picture;
			}
		}

		merged.updatedAt = Date.now();

		await this.state.storage.put(key, merged);
		return merged;
	}

	async getUserRecord(provider, userId) {
		if (!userId) {
			return null;
		}

		const userKey = buildUserKey(provider, userId);
		let record = await this.state.storage.get(userKey);

		if (!record && provider === PROVIDER_LOCAL) {
			const legacyKey = getLegacyLocalKey(userId);
			const legacyRecord = await this.state.storage.get(legacyKey);
			if (legacyRecord) {
				record = legacyRecord;
				await this.state.storage.put(userKey, record);
				await this.state.storage.delete(legacyKey);
			}
		}

		return record;
	}

	async buildProfileFromSession(session) {
		const provider = session.provider ?? PROVIDER_LOCAL;
		const userId = session.userId ?? session.username;
		if (!userId) {
			return null;
		}

		const userRecord = await this.getUserRecord(provider, userId);
		return buildProfile(provider, userId, userRecord ?? {}, session);
	}

	async handleProfileGet(searchParams) {
		const token = searchParams.get('token');
		if (!token) {
			return error('Session token is required', 400);
		}

		const session = await this.getSession(token);
		if (!session) {
			return error('Session not found', 401);
		}

		const profile = await this.buildProfileFromSession(session);
		if (!profile) {
			return error('User profile not found', 404);
		}

		return json({ success: true, profile, token });
	}

	async handleProfileUpdate(request) {
		const { token, displayName, bio } = await this.readJson(request);

		if (!token) {
			return error('Session token is required');
		}

		const session = await this.getSession(token);
		if (!session) {
			return error('Session not found', 401);
		}

		const provider = session.provider ?? PROVIDER_LOCAL;
		const userId = session.userId ?? session.username;
		if (!userId) {
			return error('Unable to resolve profile owner', 400);
		}

		const userKey = buildUserKey(provider, userId);
		const existingRecord = await this.getUserRecord(provider, userId);
		if (!existingRecord) {
			return error('User profile not found', 404);
		}

		const userRecord = { ...existingRecord };

		let hasChanges = false;

		if (displayName !== undefined) {
			const nextDisplayName = sanitizeDisplayName(displayName, userRecord.username ?? session.username ?? userId);
			if (nextDisplayName !== userRecord.displayName) {
				hasChanges = true;
				userRecord.displayName = nextDisplayName;
			}
		}

		if (bio !== undefined) {
			const nextBio = sanitizeBio(bio);
			if (nextBio !== sanitizeBio(userRecord.bio ?? '')) {
				hasChanges = true;
				userRecord.bio = nextBio;
			}
		}

		if (!hasChanges) {
			const profile = buildProfile(provider, userId, userRecord, session);
			return json({ success: true, message: 'Profile is already up to date.', profile, token });
		}

		userRecord.provider = provider;
		if (provider === PROVIDER_LOCAL && !userRecord.username) {
			userRecord.username = userId;
		}
		userRecord.updatedAt = Date.now();
		await this.state.storage.put(userKey, userRecord);

		const updatedSession = await this.updateSession(token, {
			displayName: userRecord.displayName,
			bio: userRecord.bio
		});

		const profile = buildProfile(provider, userId, userRecord, updatedSession ?? session);

		return json({
			success: true,
			message: 'Profile updated successfully.',
			profile,
			token
		});
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
