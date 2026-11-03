// Instantiate the core once per worker, before any test body.
import { init } from '@quillmark/wasm';

await init();
