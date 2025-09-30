import worker from "./worker-dist/generated-worker.js";

export * from "./worker-dist/generated-worker.js";
export { MyDurableObject, durableObjects } from "./src/worker.js";

export default worker;
