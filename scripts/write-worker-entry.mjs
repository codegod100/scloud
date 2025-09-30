import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');

const workerEntryPath = resolve(projectRoot, 'worker-entry.js');
const generatedWorkerPath = resolve(projectRoot, 'cloudflare-worker.js');
const copiedWorkerDir = resolve(projectRoot, 'worker-dist');
const copiedWorkerPath = resolve(copiedWorkerDir, 'generated-worker.js');

const wrapperContent = `import worker from "./worker-dist/generated-worker.js";\n\nexport * from "./worker-dist/generated-worker.js";\nexport { MyDurableObject, durableObjects } from "./src/worker.js";\n\nexport default worker;\n`;

try {
	const workerSource = await readFile(generatedWorkerPath, 'utf8');
	const patchedWorkerSource = workerSource
		.replaceAll('".svelte-kit/output/server/index.js"', '"../.svelte-kit/output/server/index.js"')
		.replaceAll('".svelte-kit/cloudflare-tmp/manifest.js"', '"../.svelte-kit/cloudflare-tmp/manifest.js"');
	await mkdir(copiedWorkerDir, { recursive: true });
	await writeFile(copiedWorkerPath, patchedWorkerSource, 'utf8');
	await writeFile(workerEntryPath, wrapperContent, 'utf8');
} catch (error) {
	console.error('Failed to prepare worker entry file:', error);
	process.exitCode = 1;
}
