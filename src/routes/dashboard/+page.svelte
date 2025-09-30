<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	type SessionPayload = {
		success: boolean;
		authenticated?: boolean;
		username?: string;
		profile?: {
			provider?: string;
			displayName?: string;
			email?: string;
			picture?: string;
			userId?: string;
		};
	};

const { data } = $props<{ data: { session: SessionPayload } }>();

	const SESSION_STORAGE_KEY = 'scloud-auth-token';

	let statusMessage = $state('');
	let statusIsError = $state(false);
	let isBusy = $state(false);
	let storedToken = '';

	onMount(() => {
		if (typeof localStorage === 'undefined') return;
		try {
			storedToken = localStorage.getItem(SESSION_STORAGE_KEY) ?? '';
		} catch (error) {
			storedToken = '';
		}
	});

	function setStatus(message: string, isError = false) {
		statusMessage = message;
		statusIsError = isError;
	}

	async function logout() {
		isBusy = true;
		try {
			const headers = new Headers({ 'Content-Type': 'application/json' });
			const body = storedToken ? JSON.stringify({ token: storedToken }) : JSON.stringify({});
			const response = await fetch('/api/auth/logout', {
				method: 'POST',
				headers,
				body
			});
			const text = await response.text();
			let payload: any = null;
			if (text) {
				try {
					payload = JSON.parse(text);
				} catch (error) {
					payload = null;
				}
			}

			if (!response.ok) {
				throw new Error(payload?.message ?? (text || 'Logout failed.'));
			}

			if (typeof localStorage !== 'undefined') {
				try {
					localStorage.removeItem(SESSION_STORAGE_KEY);
				} catch (error) {
					// ignore storage errors
				}
			}
			storedToken = '';

			setStatus(payload?.message ?? 'Logged out.');
			await goto('/');
		} catch (error) {
			setStatus(error instanceof Error ? error.message : 'Logout failed.', true);
		} finally {
			isBusy = false;
		}
	}

	const profile = $derived(data.session.profile ?? {});
</script>

<main class="dashboard">
	<section class="card">
		<header>
			<h1>Welcome back</h1>
			<p>You're signed in to the protected area.</p>
		</header>

		<div class="profile">
			{#if profile.picture}
				<img src={profile.picture} alt={profile.displayName ?? profile.email ?? 'Profile picture'} referrerpolicy="no-referrer" />
			{/if}
			<div>
				<p class="name">{profile.displayName ?? data.session.username ?? 'Authenticated user'}</p>
				{#if profile.email}
					<p class="email">{profile.email}</p>
				{/if}
				{#if profile.provider}
					<span class="provider">{profile.provider === 'google' ? 'Google account' : `${profile.provider} login`}</span>
				{/if}
			</div>
		</div>

		<div class="actions">
			<button type="button" onclick={logout} disabled={isBusy} class="logout">Log out</button>
			<a href="/" class="link">Back to login screen</a>
		</div>
	</section>

	{#if statusMessage}
		<p class:status-error={statusIsError} class="status">{statusMessage}</p>
	{/if}
</main>

<style>
	.dashboard {
		max-width: 720px;
		margin: 4rem auto;
		padding: 0 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.card {
		background: #ffffff;
		border-radius: 1.25rem;
		box-shadow: 0 20px 35px rgba(15, 23, 42, 0.08);
		border: 1px solid rgba(15, 23, 42, 0.06);
		padding: 2.5rem;
		display: flex;
		flex-direction: column;
		gap: 1.75rem;
	}

	header h1 {
		margin: 0;
		font-size: clamp(2rem, 4vw, 2.75rem);
	}

	header p {
		margin: 0;
		color: #64748b;
		font-size: 1rem;
	}

	.profile {
		display: flex;
		gap: 1.25rem;
		align-items: center;
	}

	.profile img {
		width: 72px;
		height: 72px;
		border-radius: 50%;
		object-fit: cover;
		border: 2px solid rgba(148, 163, 184, 0.4);
	}

	.name {
		margin: 0;
		font-size: 1.5rem;
		font-weight: 600;
		color: #0f172a;
	}

	.email {
		margin: 0.35rem 0 0;
		color: #475569;
	}

	.provider {
		display: inline-flex;
		margin-top: 0.75rem;
		padding: 0.25rem 0.65rem;
		border-radius: 999px;
		background: rgba(59, 130, 246, 0.12);
		color: #2563eb;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.actions {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	button.logout {
		background: linear-gradient(135deg, #ef4444, #f97316);
		color: #ffffff;
		border: none;
		padding: 0.75rem 1.5rem;
		border-radius: 0.75rem;
		font-size: 1rem;
		cursor: pointer;
		transition: transform 0.15s ease, box-shadow 0.2s ease;
	}

	button.logout:hover:enabled {
		transform: translateY(-1px);
		box-shadow: 0 12px 30px rgba(239, 68, 68, 0.2);
	}

	button.logout:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	a.link {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		color: #2563eb;
		text-decoration: none;
		font-weight: 600;
	}

	a.link:hover {
		text-decoration: underline;
	}

	.status {
		margin: 0;
		padding: 0.75rem 1rem;
		border-radius: 0.75rem;
		background: rgba(34, 197, 94, 0.15);
		color: #166534;
		border: 1px solid rgba(34, 197, 94, 0.3);
	}

	.status.status-error {
		background: rgba(239, 68, 68, 0.15);
		color: #b91c1c;
		border-color: rgba(239, 68, 68, 0.3);
	}

	@media (max-width: 640px) {
		.card {
			padding: 2rem;
		}

		.profile {
			flex-direction: column;
			text-align: center;
		}

		.profile img {
			width: 96px;
			height: 96px;
		}

		.actions {
			flex-direction: column;
			align-items: stretch;
		}

		button.logout {
			width: 100%;
		}

		a.link {
			justify-content: center;
		}
	}
</style>
