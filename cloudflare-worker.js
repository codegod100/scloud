import worker from './.svelte-kit/cloudflare/_worker.js';

export * from './.svelte-kit/cloudflare/_worker.js';
export { MyDurableObject } from './src/worker.js';
export default worker;
