// The browsers a built consumer's stylesheets are minified for: the first release of each
// that carries `light-dark()` and relative colour syntax, the two the surfaces cannot do
// without (THEMING §Requirements). Vite's default target sits below both, so its minifier
// lowers `light-dark()` to a pair of variables that only an element declaring
// `color-scheme` defines, and every rung the preset states at `:root` with a pole in it
// resolves there to two colours at once, which is no colour.

export const CSS_TARGET = ['chrome123', 'edge123', 'firefox128', 'safari18'];
