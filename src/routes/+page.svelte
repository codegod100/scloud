<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	const SESSION_STORAGE_KEY = 'scloud-auth-token';

	let registerUsername = $state('');
	let registerPassword = $state('');
	let loginUsername = $state('');
	let loginPassword = $state('');
	type SessionProfile = {
		provider?: string;
		username?: string;
		displayName?: string;
		email?: string;
		picture?: string;
		userId?: string;
	};

	type GoogleCredentialResponse = {
		credential?: string;
		select_by?: string;
	};

	declare global {
		interface Window {
			google?: {
				accounts?: {
					id?: {
						initialize: (config: Record<string, unknown>) => void;
						renderButton: (element: HTMLElement, options: Record<string, unknown>) => void;
						prompt: () => void;
					};
				};
			};
		}
	}

	let sessionToken = $state('');
	let loggedInUser = $state('');
	let sessionProfile = $state<SessionProfile | null>(null);
	let statusMessage = $state('');
	let statusIsError = $state(false);
	let isBusy = $state(false);
	let redirectTarget = $state('/dashboard');

	const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
	let googleButtonContainer = $state<HTMLDivElement | null>(null);
	let googleScriptPromise: Promise<void> | null = null;

	const isLoggedIn = $derived(Boolean(sessionToken));

	function persistSession(token: string) {
		if (typeof localStorage === 'undefined') return;
		try {
			localStorage.setItem(SESSION_STORAGE_KEY, token);
		} catch (error) {
			console.warn('Failed to persist session token', error);
		}
	}

	function clearPersistedSession() {
		if (typeof localStorage === 'undefined') return;
		try {
			localStorage.removeItem(SESSION_STORAGE_KEY);
		} catch (error) {
			console.warn('Failed to clear session token', error);
		}
	}

	function resetSessionState() {
		sessionToken = '';
		loggedInUser = '';
		sessionProfile = null;
		clearPersistedSession();
	}

	function setStatus(message: string, isError = false) {
		statusMessage = message;
		statusIsError = isError;
	}

	function resolveRedirectTarget(candidate: string | null | undefined) {
		if (!candidate || candidate === '/') {
			return '/dashboard';
		}

		return candidate.startsWith('/') ? candidate : '/dashboard';
	}

	async function callAuth(action: string, init: RequestInit = {}) {
		const headers = new Headers(init.headers ?? {});
		if (init.method?.toUpperCase() === 'POST' && !headers.has('Content-Type')) {
			headers.set('Content-Type', 'application/json');
		}

		const response = await fetch(`/api/auth/${action}`, {
			...init,
			headers
		});

		const text = await response.text();
		let payload: any = null;
		if (text) {
			try {
				payload = JSON.parse(text);
			} catch {
				payload = null;
			}
		}

		if (!response.ok) {
			throw new Error(payload?.message ?? (text || 'Request failed'));
		}

		return payload;
	}

	function applySessionPayload(result: any, { persist = true }: { persist?: boolean } = {}) {
		if (result?.token) {
			sessionToken = result.token;
		}

		sessionProfile = (result?.profile as SessionProfile | undefined) ?? sessionProfile;
		if (!sessionProfile) {
			sessionProfile = result?.username
				? {
					provider: 'local',
					displayName: result.username,
					username: result.username
				}
				: null;
		}

		loggedInUser = sessionProfile?.displayName ?? result?.username ?? loggedInUser;

		if (persist && sessionToken) {
			persistSession(sessionToken);
		}
	}

	function restoreSessionFromStorage() {
		if (typeof localStorage === 'undefined') return;
		try {
			const storedToken = localStorage.getItem(SESSION_STORAGE_KEY);
			if (storedToken) {
				sessionToken = storedToken;
			}
		} catch (error) {
			console.warn('Unable to restore session token from storage', error);
		}
	}

	function ensureGoogleScript(): Promise<void> {
		if (typeof window === 'undefined') {
			return Promise.resolve();
		}

		if (window.google?.accounts?.id) {
			return Promise.resolve();
		}

		if (googleScriptPromise) {
			return googleScriptPromise;
		}

		googleScriptPromise = new Promise((resolve, reject) => {
			const existing = document.getElementById('google-identity-services');
			if (existing) {
				const element = existing as HTMLScriptElement;
				if (element.dataset.gisLoaded === 'true' || element.readyState === 'complete') {
					resolve();
					return;
				}
				element.addEventListener('load', () => {
					element.dataset.gisLoaded = 'true';
					resolve();
				}, { once: true });
				element.addEventListener(
					'error',
					() => reject(new Error('Failed to load Google Identity Services script.')),
					{ once: true }
				);
				return;
			}

			const script = document.createElement('script');
			script.id = 'google-identity-services';
			script.src = 'https://accounts.google.com/gsi/client';
			script.async = true;
			script.defer = true;
			script.onload = () => {
				script.dataset.gisLoaded = 'true';
				resolve();
			};
			script.onerror = () => reject(new Error('Failed to load Google Identity Services script.'));
			document.head.appendChild(script);
		});

		return googleScriptPromise.finally(() => {
			googleScriptPromise = null;
		});
	}

	async function initGoogleSignIn() {
		if (typeof window === 'undefined') {
			return;
		}

		if (!GOOGLE_CLIENT_ID) {
			console.warn('VITE_GOOGLE_CLIENT_ID is not defined. Google Sign-In will be disabled.');
			return;
		}

		try {
			await ensureGoogleScript();
			const googleId = window.google?.accounts?.id;
			if (!googleId) {
				throw new Error('Google Identity Services failed to initialize.');
			}

			googleId.initialize({
				client_id: GOOGLE_CLIENT_ID,
				callback: handleGoogleCredential,
				auto_select: false
			});

			if (googleButtonContainer) {
				googleId.renderButton(googleButtonContainer, {
					theme: 'outline',
					size: 'large',
					shape: 'pill',
					text: 'signin_with',
					width: 312
				});
			}

			googleId.prompt();
		} catch (error) {
			console.error('Unable to initialise Google Sign-In', error);
			setStatus('Google Sign-In is unavailable right now.', true);
		}
	}

	async function handleGoogleCredential(response: GoogleCredentialResponse) {
		if (!response?.credential) {
			setStatus('Google sign-in did not return a credential.', true);
			return;
		}

		isBusy = true;
		try {
			const result = await callAuth('google', {
				method: 'POST',
				body: JSON.stringify({ credential: response.credential })
			});
			applySessionPayload(result);
			setStatus(result?.message ?? 'Signed in with Google.');
			await goto(redirectTarget || '/dashboard');
		} catch (error) {
			resetSessionState();
			setStatus(error instanceof Error ? error.message : 'Google sign-in failed.', true);
		} finally {
			isBusy = false;
		}
	}

	async function registerUser() {
		if (!registerUsername || !registerPassword) {
			setStatus('Please provide a username and password to register.', true);
			return;
		}

		isBusy = true;
		try {
			const result = await callAuth('register', {
				method: 'POST',
				body: JSON.stringify({ username: registerUsername, password: registerPassword })
			});
			setStatus(result?.message ?? 'Account created successfully.');
			registerPassword = '';
		} catch (error) {
			setStatus(error instanceof Error ? error.message : 'Registration failed.', true);
		} finally {
			isBusy = false;
		}
	}

	function handleRegisterSubmit(event: SubmitEvent) {
		event.preventDefault();
		registerUser();
	}

	async function loginUser() {
		if (!loginUsername || !loginPassword) {
			setStatus('Please provide a username and password to log in.', true);
			return;
		}

		isBusy = true;
		try {
			const result = await callAuth('login', {
				method: 'POST',
				body: JSON.stringify({ username: loginUsername, password: loginPassword })
			});
			applySessionPayload(result);
			setStatus(result?.message ?? 'Login successful.');
			loginPassword = '';
			await goto(redirectTarget || '/dashboard');
		} catch (error) {
			resetSessionState();
			setStatus(error instanceof Error ? error.message : 'Login failed.', true);
		} finally {
			isBusy = false;
		}
	}

	function handleLoginSubmit(event: SubmitEvent) {
		event.preventDefault();
		loginUser();
	}


	async function logoutUser() {
		isBusy = true;
		try {
			const payload = sessionToken ? { token: sessionToken } : {};
			const result = await callAuth('logout', {
				method: 'POST',
				body: JSON.stringify(payload)
			});
			resetSessionState();
			redirectTarget = '/dashboard';
			setStatus(result?.message ?? 'Logged out successfully.');
		} catch (error) {
			setStatus(error instanceof Error ? error.message : 'Logout failed.', true);
		} finally {
			isBusy = false;
		}
	}

	async function refreshSession({
		silent = false,
		redirectOnSuccess = false,
		redirectTo = '/dashboard'
	} = {}) {
		if (!sessionToken) {
			if (!silent) {
				setStatus('No session token available. Log in first.', true);
			}
			return;
		}

		if (!silent) {
			isBusy = true;
		}
		try {
			const params = new URLSearchParams({ token: sessionToken });
			const response = await fetch(`/api/auth/session?${params}`);
			const text = await response.text();
			let payload: any = null;
			if (text) {
				try {
					payload = JSON.parse(text);
				} catch {
					payload = null;
				}
			}

			if (!response.ok) {
				throw new Error(payload?.message ?? (text || 'Session lookup failed.'));
			}

			if (payload?.token) {
				sessionToken = payload.token;
			}

			sessionProfile = (payload?.profile as SessionProfile | undefined) ?? sessionProfile;
			loggedInUser = sessionProfile?.displayName ?? payload?.username ?? '';
			if (!silent) {
				const providerLabel = sessionProfile?.provider
					? ` via ${sessionProfile.provider === 'google' ? 'Google' : sessionProfile.provider}`
					: '';
				setStatus(
					loggedInUser
						? `Authenticated as ${loggedInUser}${providerLabel}.`
						: 'Session is active.'
				);
			}
			if (sessionToken) {
				persistSession(sessionToken);
			}
			if (redirectOnSuccess) {
				await goto(redirectTo);
			}
		} catch (error) {
			resetSessionState();
			if (!silent) {
				setStatus(error instanceof Error ? error.message : 'Failed to refresh session.', true);
			}
		} finally {
			if (!silent) {
				isBusy = false;
			}
		}
	}

	onMount(() => {
		restoreSessionFromStorage();
		if (typeof window !== 'undefined') {
			redirectTarget = resolveRedirectTarget(new URL(window.location.href).searchParams.get('redirect'));
		}
		const target = redirectTarget || '/dashboard';
		refreshSession({ silent: true, redirectOnSuccess: true, redirectTo: target }).catch(() => {
			// Errors handled within refreshSession.
		});
		initGoogleSignIn();
	});
</script>

<main class="layout">
	<header>
		<h1>Durable Object Authentication Demo</h1>
		<p>Register, log in, and manage a user session powered by a Cloudflare Durable Object.</p>
	</header>

	<section class="grid">
		<div class="card">
			<h2>Create an account</h2>
			<form class="form" onsubmit={handleRegisterSubmit}>
				<label for="register-username">Username</label>
				<input
					id="register-username"
					bind:value={registerUsername}
					type="text"
					autocomplete="username"
					placeholder="your-username"
				/>
				<label for="register-password">Password</label>
				<input
					id="register-password"
					bind:value={registerPassword}
					type="password"
					autocomplete="new-password"
					placeholder="choose a password"
				/>
				<button type="submit" class="primary" disabled={isBusy}>Register</button>
			</form>
		</div>

		<div class="card">
			<h2>Log in</h2>
			<form class="form" onsubmit={handleLoginSubmit}>
				<label for="login-username">Username</label>
				<input
					id="login-username"
					bind:value={loginUsername}
					type="text"
					autocomplete="username"
					placeholder="your-username"
				/>
				<label for="login-password">Password</label>
				<input
					id="login-password"
					bind:value={loginPassword}
					type="password"
					autocomplete="current-password"
					placeholder="your password"
				/>
				<button type="submit" class="primary" disabled={isBusy}>Log in</button>
			</form>
		</div>

			<div class="card google-card">
				<h2>Continue with Google</h2>
				<p class="subtext">Sign in without a password using your Google account.</p>
				{#if GOOGLE_CLIENT_ID}
					<div class="google-button" bind:this={googleButtonContainer}></div>
					<p class="google-note">We only request your verified email and basic profile info.</p>
				{:else}
					<p class="google-missing">Google Sign-In is unavailable until a client ID is configured.</p>
				{/if}
			</div>
	</section>

	<section class="card">
		<h2>Session status</h2>
		{#if isLoggedIn}
				<div class="session-meta">
					{#if sessionProfile?.picture}
						<img class="avatar" src={sessionProfile.picture} alt={loggedInUser} referrerpolicy="no-referrer" />
					{/if}
					<div>
						<p class="session">
							Signed in as <strong>{loggedInUser}</strong>
							{#if sessionProfile?.provider}
								<span class="provider-badge">
									{sessionProfile.provider === 'google' ? 'Google' : sessionProfile.provider}
								</span>
							{/if}
						</p>
						{#if sessionProfile?.email && sessionProfile.email !== loggedInUser}
							<p class="session-email">{sessionProfile.email}</p>
						{/if}
					</div>
				</div>
			<details>
				<summary>Session token</summary>
				<code>{sessionToken}</code>
			</details>
			<div class="actions">
				<button type="button" onclick={() => refreshSession()} disabled={isBusy}>Refresh session</button>
				<button type="button" class="secondary" onclick={logoutUser} disabled={isBusy}>Log out</button>
			</div>
		{:else}
			<p class="session">No active session. Log in to begin.</p>
		{/if}
	</section>

	{#if statusMessage}
		<p class="status-message" class:status-error={statusIsError}>{statusMessage}</p>
	{/if}
</main>

<style>
	:global(body) {
		font-family: 'Inter', system-ui, sans-serif;
		margin: 0;
		background: #f7f7fb;
		color: #1f2933;
	}

	main.layout {
		max-width: 960px;
		margin: 0 auto;
		padding: 3rem 1.5rem 4rem;
		display: flex;
		flex-direction: column;
		gap: 2rem;
	}

	header h1 {
		margin: 0 0 0.5rem;
		font-size: clamp(2rem, 4vw, 2.75rem);
	}

	header p {
		margin: 0;
		color: #52606d;
	}

	.grid {
		display: grid;
		gap: 1.5rem;
		grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
	}

	.card {
		background: #ffffff;
		border-radius: 1rem;
		padding: 2rem;
		box-shadow: 0 20px 35px rgba(15, 23, 42, 0.08);
		border: 1px solid rgba(15, 23, 42, 0.06);
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.google-card {
		justify-content: center;
		text-align: center;
	}

	.subtext {
		margin: 0;
		color: #52606d;
	}

	.card h2 {
		margin: 0;
		font-size: 1.3rem;
	}

	.form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	label {
		font-weight: 600;
		color: #334155;
	}

	input {
		padding: 0.65rem 0.75rem;
		border-radius: 0.65rem;
		border: 1px solid rgba(148, 163, 184, 0.8);
		font-size: 1rem;
		background: #f9fafc;
	}

	input:focus {
		outline: none;
		border-color: #6366f1;
		box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2);
		background: #ffffff;
	}

	.google-button {
		display: flex;
		justify-content: center;
	}

	.google-note {
		margin: 0;
		font-size: 0.875rem;
		color: #64748b;
	}

	.google-missing {
		margin: 0;
		font-size: 0.9rem;
		color: #b91c1c;
	}

	button {
		cursor: pointer;
		border: none;
		font-size: 0.95rem;
		padding: 0.65rem 1.25rem;
		border-radius: 0.75rem;
		transition: transform 0.15s ease, box-shadow 0.2s ease;
	}

	button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	button.primary {
		background: linear-gradient(135deg, #6366f1, #8b5cf6);
		color: white;
		box-shadow: 0 10px 25px rgba(99, 102, 241, 0.3);
	}

	button.primary:hover:enabled {
		transform: translateY(-1px);
		box-shadow: 0 12px 30px rgba(99, 102, 241, 0.35);
	}

	button.secondary {
		background: #0f172a;
		color: white;
	}

	button.secondary:hover:enabled {
		transform: translateY(-1px);
		box-shadow: 0 12px 30px rgba(15, 23, 42, 0.25);
	}

	.actions {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.session {
		margin: 0;
		color: #334155;
	}

	.session-meta {
		display: flex;
		align-items: center;
		gap: 0.85rem;
	}

	.avatar {
		width: 48px;
		height: 48px;
		border-radius: 50%;
		object-fit: cover;
		border: 2px solid rgba(148, 163, 184, 0.4);
	}

	.provider-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		margin-left: 0.5rem;
		padding: 0.2rem 0.55rem;
		font-size: 0.75rem;
		border-radius: 999px;
		background: rgba(59, 130, 246, 0.12);
		color: #2563eb;
		text-transform: capitalize;
	}

	.session-email {
		margin: 0.25rem 0 0;
		color: #64748b;
		font-size: 0.9rem;
	}

	code {
		display: block;
		margin-top: 0.5rem;
		padding: 0.5rem 0.75rem;
		background: #f3f4f6;
		border-radius: 0.5rem;
		font-family: 'Fira Code', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		word-break: break-all;
	}

	.status-message {
		padding: 0.85rem 1.1rem;
		border-radius: 0.75rem;
		background: rgba(34, 197, 94, 0.15);
		color: #166534;
		border: 1px solid rgba(34, 197, 94, 0.3);
		margin: 0;
	}

	.status-error {
		background: rgba(239, 68, 68, 0.15);
		color: #b91c1c;
		border-color: rgba(239, 68, 68, 0.3);
	}

	@media (max-width: 640px) {
		main.layout {
			padding: 2.5rem 1rem 3rem;
		}

		.card {
			padding: 1.5rem;
		}

		button {
			width: 100%;
		}

		.actions {
			flex-direction: column;
		}
	}
</style>
