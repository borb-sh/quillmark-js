// Instantiate the core once per worker, before any test body. The gate is memoized
// and is the only door to `Quill`, so a module that awaits `init()` for the class
// shares this instantiation rather than paying for its own.
import { init } from '@quillmark/wasm';

await init();
