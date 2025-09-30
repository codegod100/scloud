<script lang="ts">
	let data = $state('');
	let storedData = $state('');

	async function storeData() {
		const response = await fetch('/api/do', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ message: data })
		});

		if (response.ok) {
			data = '';
			await retrieveData();
		}
	}

	async function retrieveData() {
		const response = await fetch('/api/do');
		if (response.ok) {
			const result = await response.json();
			storedData = JSON.stringify(result);
		}
	}
</script>

<h1>Welcome to SvelteKit</h1>
<p>Visit <a href="https://svelte.dev/docs/kit">svelte.dev/docs/kit</a> to read the documentation</p>

<h2>Durable Object Demo</h2>
<input bind:value={data} placeholder="Enter data to store" />
<button onclick={storeData}>Store Data</button>
<button onclick={retrieveData}>Retrieve Data</button>
<p>Stored Data: {storedData}</p>
