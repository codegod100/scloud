# Project Agents Notes

- Primary framework: **Svelte 5**
- Authentication stack: Cloudflare Durable Object with local credentials + Google Identity Services
- Event handlers: prefer classic attributes (`onclick`, `onsubmit`) over `on:` directives to avoid mixed-syntax build errors
