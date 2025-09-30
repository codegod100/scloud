<script lang="ts">
	import { onMount } from 'svelte';

	const SESSION_STORAGE_KEY = 'scloud-auth-token';

	let registerUsername = $state('');
	let registerPassword = $state('');
	let loginUsername = $state('');
	let loginPassword = $state('');
	let sessionToken = $state('');
	let loggedInUser = $state('');
	let statusMessage = $state('');
	let statusIsError = $state(false);
	let isBusy = $state(false);

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
		clearPersistedSession();
	}

	function setStatus(message: string, isError = false) {
		statusMessage = message;
		statusIsError = isError;
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
			sessionToken = result?.token ?? '';
			loggedInUser = result?.username ?? '';
			setStatus(result?.message ?? 'Login successful.');
			if (sessionToken) {
				persistSession(sessionToken);
			}
			loginPassword = '';
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
		if (!sessionToken) {
			setStatus('There is no active session to log out of.', true);
			return;
		}

		isBusy = true;
		try {
			const result = await callAuth('logout', {
				method: 'POST',
				body: JSON.stringify({ token: sessionToken })
			});
			resetSessionState();
			setStatus(result?.message ?? 'Logged out successfully.');
		} catch (error) {
			setStatus(error instanceof Error ? error.message : 'Logout failed.', true);
		} finally {
			isBusy = false;
		}
	}

	async function refreshSession({ silent = false } = {}) {
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

			loggedInUser = payload?.username ?? '';
			if (!silent) {
				setStatus(
					loggedInUser
						? `Authenticated as ${loggedInUser}.`
						: 'Session is active.'
				);
			}
			if (sessionToken) {
				persistSession(sessionToken);
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
			try {
				const storedToken = localStorage.getItem(SESSION_STORAGE_KEY);
				if (storedToken) {
					sessionToken = storedToken;
					refreshSession({ silent: true });
				}
			} catch (error) {
				console.warn('Unable to restore session token from storage', error);
			}
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
	</section>

	<section class="card">
		<h2>Session status</h2>
		{#if isLoggedIn}
			<p class="session">Signed in as <strong>{loggedInUser}</strong></p>
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
