// Instantiate the core once per worker, before any test body, through the package's own gate,
// which the binding's sync verbs read.
import { init } from '../src/core.js';

await init();
