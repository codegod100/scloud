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
			bio?: string;
		};
		token?: string;
	};

	const { data } = $props<{ data: { session: SessionPayload } }>();

	type ProfilePayload = NonNullable<SessionPayload['profile']>;

	const SESSION_STORAGE_KEY = 'scloud-auth-token';

	let statusMessage = $state('');
	let statusIsError = $state(false);
	let isBusy = $state(false);
	let storedToken = '';
	let profileState = $state<ProfilePayload | undefined>(data.session.profile);
	let displayNameInput = $state(data.session.profile?.displayName ?? '');
	let bioInput = $state(data.session.profile?.bio ?? '');
	let isSavingProfile = $state(false);
	let isEditingProfile = $state(false);

	onMount(() => {
		const sessionToken = data.session.token ?? '';
		if (typeof localStorage === 'undefined') {
			storedToken = sessionToken || storedToken;
			return;
		}

		try {
			storedToken = localStorage.getItem(SESSION_STORAGE_KEY) ?? '';
		} catch (error) {
			storedToken = '';
		}

		if (!storedToken && sessionToken) {
			storedToken = sessionToken;
			try {
				localStorage.setItem(SESSION_STORAGE_KEY, storedToken);
			} catch (error) {
				// ignore storage errors
			}
		}
	});

	function setStatus(message: string, isError = false) {
		statusMessage = message;
		statusIsError = isError;
	}

	const profile = $derived(profileState ?? {});

	const profileIsDirty = $derived(() => {
		const savedDisplay = (profile.displayName ?? '').trim();
		const savedBio = (profile.bio ?? '').trim();
		return displayNameInput.trim() !== savedDisplay || bioInput.trim() !== savedBio;
	});

	const canSaveProfile = $derived(() => !isSavingProfile && profileIsDirty && Boolean(displayNameInput.trim()));

	function beginProfileEdit() {
		const currentProfile = profileState ?? data.session.profile ?? {};
		displayNameInput = currentProfile.displayName ?? '';
		bioInput = currentProfile.bio ?? '';
		setStatus('');
		isEditingProfile = true;
	}

	function cancelProfileEdit() {
		const currentProfile = profileState ?? data.session.profile ?? {};
		displayNameInput = currentProfile.displayName ?? '';
		bioInput = currentProfile.bio ?? '';
		isEditingProfile = false;
		setStatus('');
	}

	async function saveProfile(event?: Event) {
		event?.preventDefault();

		const nextDisplayName = displayNameInput.trim();
		const nextBio = bioInput.trim();

		if (!nextDisplayName) {
			setStatus('Display name cannot be empty.', true);
			return;
		}

		isSavingProfile = true;
		try {
			const headers = new Headers({ 'Content-Type': 'application/json' });
			const body: Record<string, unknown> = {
				displayName: nextDisplayName,
				bio: nextBio
			};
			if (storedToken) {
				body.token = storedToken;
			}

			const response = await fetch('/api/auth/profile', {
				method: 'POST',
				headers,
				body: JSON.stringify(body)
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

			if (!response.ok || payload?.success === false) {
				throw new Error(payload?.message ?? (text || 'Failed to update profile.'));
			}

			if (payload?.token && typeof payload.token === 'string') {
				storedToken = payload.token;
				if (typeof localStorage !== 'undefined') {
					try {
						localStorage.setItem(SESSION_STORAGE_KEY, storedToken);
					} catch (error) {
						// ignore storage errors
					}
				}
			}

			if (payload?.profile) {
				profileState = payload.profile as ProfilePayload;
				displayNameInput = profileState?.displayName ?? nextDisplayName;
				bioInput = profileState?.bio ?? nextBio;
			}

			setStatus(payload?.message ?? 'Profile updated.');
			isEditingProfile = false;
		} catch (error) {
			setStatus(error instanceof Error ? error.message : 'Failed to update profile.', true);
		} finally {
			isSavingProfile = false;
		}
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
				{#if profile.bio?.trim()}
					<p class="bio-text">{profile.bio}</p>
				{:else}
					<p class="bio-text empty">No bio set yet.</p>
				{/if}
			</div>
		</div>

		{#if isEditingProfile}
			<form class="profile-form" onsubmit={saveProfile}>
				<div class="field">
					<label for="display-name">Display name</label>
					<input
						id="display-name"
						type="text"
						bind:value={displayNameInput}
						maxlength="64"
						placeholder="How should we address you?"
					/>
				</div>
				<div class="field">
					<label for="bio">Bio</label>
					<textarea
						id="bio"
						rows="4"
						maxlength="400"
						bind:value={bioInput}
						placeholder="Share a short description about yourself."
					></textarea>
					<p class="hint">{bioInput.length}/400</p>
				</div>
				<div class="form-actions">
					<button type="submit" class="save" disabled={!canSaveProfile}>
						{isSavingProfile ? 'Saving…' : 'Save changes'}
					</button>
					<button type="button" class="cancel" onclick={cancelProfileEdit} disabled={isSavingProfile}>
						Cancel
					</button>
				</div>
			</form>
		{:else}
			<div class="profile-actions">
				<button type="button" class="edit" onclick={beginProfileEdit}>
					Edit profile
				</button>
			</div>
		{/if}

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

	.bio-text {
		margin: 0.85rem 0 0;
		color: #475569;
		line-height: 1.6;
		white-space: pre-wrap;
	}

	.bio-text.empty {
		font-style: italic;
		color: #94a3b8;
	}

	.profile-form {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.profile-actions {
		display: flex;
		justify-content: flex-start;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.field label {
		font-weight: 600;
		color: #1f2937;
	}

	.field input,
	.field textarea {
		font-size: 1rem;
		padding: 0.65rem 0.75rem;
		border-radius: 0.75rem;
		border: 1px solid rgba(148, 163, 184, 0.8);
		background: #f9fafb;
		color: #0f172a;
		transition: border-color 0.2s ease, box-shadow 0.2s ease;
	}

	.field input:focus,
	.field textarea:focus {
		outline: none;
		border-color: #6366f1;
		box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2);
		background: #ffffff;
	}

	.field textarea {
		resize: vertical;
		min-height: 120px;
	}

	.field .hint {
		margin: 0;
		font-size: 0.8rem;
		color: #94a3b8;
		text-align: right;
	}

	button.save {
		align-self: flex-start;
		background: linear-gradient(135deg, #6366f1, #8b5cf6);
		color: #ffffff;
		border: none;
		padding: 0.7rem 1.4rem;
		border-radius: 0.75rem;
		font-weight: 600;
		cursor: pointer;
		transition: transform 0.15s ease, box-shadow 0.2s ease;
	}

	.form-actions {
		display: flex;
		gap: 0.75rem;
		align-items: center;
	}

	button.edit {
		background: #eef2ff;
		color: #4338ca;
		border: 1px solid rgba(99, 102, 241, 0.35);
		padding: 0.6rem 1.2rem;
		border-radius: 0.75rem;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.2s ease, border-color 0.2s ease;
	}

	button.edit:hover {
		background: rgba(99, 102, 241, 0.15);
		border-color: rgba(99, 102, 241, 0.55);
	}

	button.cancel {
		background: transparent;
		color: #64748b;
		border: 1px solid rgba(100, 116, 139, 0.4);
		padding: 0.6rem 1.2rem;
		border-radius: 0.75rem;
		font-weight: 500;
		cursor: pointer;
		transition: border-color 0.2s ease, color 0.2s ease;
	}

	button.cancel:hover:enabled {
		color: #475569;
		border-color: rgba(100, 116, 139, 0.7);
	}

	button.save:disabled {
		opacity: 0.6;
		cursor: not-allowed;
		box-shadow: none;
	}

	button.save:hover:enabled {
		transform: translateY(-1px);
		box-shadow: 0 12px 28px rgba(99, 102, 241, 0.25);
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

		button.save {
			width: 100%;
		}

		a.link {
			justify-content: center;
		}
	}
</style>
