# SCloud Auth Demo

A SvelteKit (Svelte 5) demo that shows how to build password-based and Google-powered authentication on Cloudflare Workers using Durable Objects for stateful session management.

## Features

- Durable Object stores user accounts and sessions (both local credentials and Google identities).
- REST-like `/api/auth` endpoints that proxy to the Durable Object.
- Progressive Svelte front-end with session persistence in `localStorage`, protected routes, and graceful SSR fallbacks.
- Google Identity Services integration that verifies ID tokens inside the Durable Object before issuing a session token.

## Prerequisites

- Node.js 18+
- [`pnpm`](https://pnpm.io/) (preferred) or npm/yarn
- [`wrangler`](https://developers.cloudflare.com/workers/wrangler/) CLI authenticated with your Cloudflare account
- A Google Cloud project with an OAuth client ID configured for the **Web** application type

## Configuration

Set the following environment variables before building or starting the app:

| Variable | Scope | Purpose |
| --- | --- | --- |
| `VITE_GOOGLE_CLIENT_ID` | Build/dev server | Exposes the Google client ID to the browser bundle. |
| `GOOGLE_CLIENT_ID` | Worker/Durable Object | Enforces that incoming Google ID tokens were issued for the expected client ID. |

During local development you can add them to an `.env` file (read by Vite) and to `wrangler.toml`/`wrangler.jsonc` under `vars` for the worker runtime. The values are safe to expose publicly but should remain consistent between the browser and worker.

### Authorize your origins in Google Cloud

In the [Google Cloud Console](https://console.cloud.google.com/apis/credentials), edit the OAuth client that provides your `GOOGLE_CLIENT_ID` and add the JavaScript origins you expect to use:

- `http://localhost:5173` (local Vite dev server)
- `https://<your-workers-subdomain>.workers.dev` and/or your production domain

Without these entries, Google will block the button iframe with a 403 and log `The given origin is not allowed for the given client ID.`

## Install & Develop

```sh
pnpm install
pnpm dev
```

The dev server starts at <http://localhost:5173>. API calls proxy through Vite to the Cloudflare worker defined by `wrangler.toml`.

To run the Worker/Durable Object locally:

```sh
pnpm build
wrangler dev
```

## Build & Deploy

```sh
pnpm build
wrangler deploy
```

Deployment publishes both the static site and the Worker with its Durable Object namespace. Ensure you've set the required environment variables in your Cloudflare project prior to deploying.

## Testing the Flow

1. Register a local account with a username/password or choose “Continue with Google”.
2. After a successful sign-in you’ll be redirected to `/dashboard`, a protected page that requires a valid session cookie.
3. Observe the persisted session state and provider metadata in the UI, then use “Log out” to invalidate the cookie and return to the public login view.

## Troubleshooting

- **Google Sign-In button missing** – Confirm `VITE_GOOGLE_CLIENT_ID` is set when running `pnpm dev` or `pnpm build`.
- **“Unable to verify Google credential”** – Double-check the Worker has `GOOGLE_CLIENT_ID` set to the same value as the browser client ID.
- **“The given origin is not allowed for the given client ID.”** – Add the current origin (including port) to the OAuth client’s *Authorized JavaScript origins* list in Google Cloud.
- **Durable Object not available** – Ensure `wrangler dev`/`wrangler deploy` executed successfully and the namespace binding name matches `MY_DO` in `wrangler.jsonc`.
