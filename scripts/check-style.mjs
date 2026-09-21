// The scale, from where it is minted to what a consumer is served. One rule over every
// scope: a stylesheet reads a rung, it does not mint a value (ARCHITECTURE §Styling). The
// scopes differ only in which prefix they read and which file mints it, so they are a
// table rather than a script apiece.
//
//   rhythm   padding / margin / gap / radius, every spelling   a px|rem length
//   stroke   border / border-*-width                           a length, at any width
//   type     font                                              anything but a CSS-wide keyword
//            font-size / font-weight / font-family             a size, a weight, a family
//            line-height                                       a leading off the two rungs
//   colour   color / background / border / shadow …            a hex or a colour function
//   recede   opacity                                           a step off the ladder
//   motion   transition / animation                            an s|ms time, a curve, `all`
//
// A declaration mints anyway by saying why: a `/* mint: <reason> */` comment on it or
// directly above it exempts that line, and the gate counts what it let through. The reason
// is the mechanism — a bare marker is a suppression. A derivation is exempt throughout,
// being the place its scale's defaults are minted.
//
// Three rules sit beside the table:
//
//   · A private rung is defined only in its scope's derivation. Minting one elsewhere
//     forks the scale rather than trying a value in it, so the escape does not reach it.
//   · The surfaces rank under a consumer's own CSS: their sheets carry no class, id or
//     attribute outside `:where()`, and nothing in the scope declares a cascade layer, so
//     a host's rule wins whatever order a bundler emits the sheets in (THEMING §"Your CSS
//     beats ours"). The same rank holds over the contract classes wherever a component
//     draws one, Svelte's scoping class otherwise outranking the bare class a consumer is
//     told to write.
//   · Every `--qm-*` dial a surface consumes is documented in THEMING.md, and every
//     `.qm-*` class the doc promises is carried by something in `src/` — the halves a
//     consumer is hurt by. The reverse halves warn, so prose may run ahead of code.
//
// `--built <dirs…>` runs the other end instead (`npm run check:bundle`, after
// `npm run build`): in a built consumer, every rung a shipped stylesheet mints and the
// bundle reads is defined in that bundle. A side-effect stylesheet import is an edge
// carrying no binding, so a bundler told that module is side-effect-free prunes it and the
// surface mounts unstyled, with every `var()` reading the pruned scale invalid at
// computed-value time and its whole declaration dropped. The rungs are discovered rather
// than listed, and it is presence against absence, so a renamed scale and a retuned dial
// both leave it green.
//
// What is outside it: `.ts` (`preview/paint.ts` carries declarations in JS strings), a
// value's own shape past its axis, and the shadow, pole and cross-scope rules — all
// review's, and visible in a diff.

import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import postcss from 'postcss';
import { ROOT, filesUnder, packages, report } from './workspace.mjs';

const THEMING = join(ROOT, 'packages', 'svelte', 'THEMING.md');

/** The closed scales, each with the tree that reads it and the one file that mints it.
 *  `census` marks the scopes the dial contract is measured over, THEMING.md documenting
 *  what the package consumes. `surface` is the one scale declared on a mounted root rather
 *  than on a document, which is the set the rank rule runs over. `exclude` keeps a nested
 *  scope from being scanned twice: the preset ships from inside `src/lib`, because
 *  `svelte-package` reads no other tree. */
const SCOPES = [
	{
		dir: 'packages/svelte/src/lib',
		exclude: ['packages/svelte/src/lib/preset'],
		prefix: '--_qm-',
		derivation: 'packages/svelte/src/lib/core/theme.css',
		doc: 'ARCHITECTURE §Styling',
		census: true,
		surface: true
	},
	{
		dir: 'packages/svelte/src/lib/preset',
		prefix: '--qmh-',
		derivation: 'packages/svelte/src/lib/preset/scale.css',
		doc: 'THEMING §"Match ours"',
		census: true
	},
	{
		dir: 'packages/playground/src/routes',
		prefix: '--pg-',
		derivation: 'packages/playground/src/routes/playground.css',
		doc: 'ARCHITECTURE §Styling'
	},
	{
		dir: 'packages/quillkit/client',
		// The dev server's packed quiver, which is generated and gitignored.
		exclude: ['packages/quillkit/client/public'],
		prefix: '--st-',
		derivation: 'packages/quillkit/client/studio.css',
		doc: 'ARCHITECTURE §Styling'
	}
];

/** The prose leaf's interior, which ranks against ProseMirror's own unlayered sheet rather
 *  than against a consumer, and carries no class THEMING promises. */
const RANK_EXEMPT = ['packages/svelte/src/lib/core/codec/prose.css'];
/** What a consumer is invited to aim a rule at, so every file drawing one answers to the
 *  rank rule (ARCHITECTURE §Styling for the form that satisfies it in a `<style>` block). */
const SURFACE_CONTRACT = ['qm-editor', 'qm-preview', 'qm-pane'];

/** A colour literal: hex, or a functional notation that names a colour space. */
const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/;
/** A length literal, for the axes whose values are sizes. Rhythm keeps its own narrower
 *  shape (`px|rem`); type and stroke count `em` too. */
const LENGTH_LITERAL = /\b\d*\.?\d+(px|rem|em)\b/;
/** The escape, with its reason. The lookahead keeps a comment's own closing delimiter from
 *  reading as one. */
const MINT = /mint:\s*(?!\*\/)(\S[^*\n]*)/;
/** Comments blanked, in the three shapes this workspace's sources carry them: a `qm-` name
 *  a comment mentions is prose about a class, not a class drawn. The line form is guarded
 *  on what precedes it, so a `https://` in a url is not a comment. */
const decomment = (text) =>
	text
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/(^|[^:\w])\/\/[^\n]*/gm, '$1');
/** A class in source, and never a dial: `--qm-space` carries `qm-space` after a dash too. */
const CLASS_IN_SRC = /(?<![-\w])qm-[\w-]+/g;

// Three shapes of rule. `literal` forbids a pattern — most properties take values a
// literal cannot be mistaken for, so naming the bad shape is enough. `allowBare` requires a
// rung, listing the few values legitimate without one, for where any value at all is a
// scale decision. `only` requires one of a fixed set and takes no rung escape, for the one
// property where naming a rung is not enough to make a value safe.
const AXES = [
	{
		// Every spelling of one decision: the physical longhands, the logical ones, and the
		// radius corners. An axis naming only the physical forms is a gate a rewrite walks
		// through.
		props: /^(border(-[\w-]+)?-radius|gap|row-gap|column-gap|(padding|margin)(-[\w-]+)?)$/,
		literal: /\b\d*\.?\d+(px|rem)\b/,
		rung: '`var(--_qm-space-…)` / `var(--_qm-radius…)`'
	},
	{
		// Stroke width, which the colour axis below cannot see: it tests `border-*` for a
		// colour literal, so `border-left: 2px solid var(--_qm-border)` reads a rung, passes,
		// and renders at a width nothing chose. Shorthands included, since that is where the
		// width hides.
		props: /^border(-(top|right|bottom|left))?(-width)?$/,
		literal: LENGTH_LITERAL,
		rung: '`var(--_qm-border-width)`'
	},
	{ props: /^font-size$/, literal: LENGTH_LITERAL, rung: '`var(--_qm-text-…)`' },
	{
		// The CSS-wide keywords carry no hierarchy decision, so they are not a scale escape.
		props: /^font-weight$/,
		literal: /\b(\d{3}|bold|bolder|lighter|normal)\b/,
		rung: '`var(--_qm-weight-…)`'
	},
	{
		// Leading has no literal shape to forbid — a bare number is what a rung resolves to —
		// so the rung is required instead. `1` is the one bare value that is not a step on
		// the ramp: a line box collapsed onto its content, structural like `opacity: 0`.
		props: /^line-height$/,
		allowBare: /^1$/,
		rung: '`var(--_qm-leading-…)`'
	},
	{
		// A family is a scale decision whatever it names. `inherit` is how a control defers
		// to its surface, which is reading the scale one level up.
		props: /^font-family$/,
		allowBare: /^(inherit|initial|unset|revert)$/,
		rung: '`var(--_qm-font)` / `var(--_qm-font-mono)`'
	},
	{
		// The shorthand sets family, size and leading in one declaration, past three axes that
		// each watch a single longhand, so it takes no rung escape: `font: 600 12px/1.2
		// var(--_qm-font)` names a rung and still mints a size and a leading. A surface defers
		// with `font: inherit` and restates the rungs it wants as longhands after it.
		props: /^font$/,
		only: /^(inherit|initial|unset|revert)$/,
		fix: 'defer with `font: inherit` and read the rungs as longhands after it'
	},
	{ props: /^opacity$/, allowBare: /^[01]$/, rung: '`var(--_qm-opacity-…)`' },
	{
		props:
			/^(color|fill|stroke|background|border|outline|box-shadow|text-shadow|backdrop-filter|-webkit-backdrop-filter)(-[\w-]+)?$/,
		literal: COLOR_LITERAL,
		rung: '`var(--_qm-…)`'
	},
	{
		// The axis with no natural units of its own: every value looks plausible, so a surface
		// picking its own drifts silently. `none` carries no time and passes.
		props: /^(transition|animation)(-(duration|delay))?$/,
		literal: /\b\d*\.?\d+m?s\b/,
		rung: '`var(--_qm-duration-…)`'
	},
	{
		// A curve is a rung like any other value, `ease` included: the UA keyword is a curve
		// the surface chose, not the absence of one. A value-level "does it read a rung" test
		// passes with the curve spelled out beside the duration, so the keyword is forbidden
		// instead. The lookbehind keeps `--_qm-ease-arrive` from matching itself.
		props: /^(transition|animation)(-timing-function)?$/,
		literal: /(?<![-\w])(ease|linear|cubic-bezier|steps|step-(start|end))\b/,
		rung: '`var(--_qm-ease-…)`'
	},
	{
		// `all` is not a property list, it is the absence of one: it animates whatever a later
		// edit adds to either rest state, which is the one drift no reviewer sees in the diff
		// that causes it.
		props: /^(transition|transition-property)$/,
		literal: /\ball\b/,
		lead: 'animates an open set',
		fix: 'name the properties that differ between the two rest states'
	}
];

const errors = [];
const warnings = [];

/** A scope's own tree, its nested scopes cut out. */
const under = (scope, ext) =>
	filesUnder(join(ROOT, scope.dir), ext, {
		skip: (scope.exclude ?? []).map((d) => join(ROOT, d))
	});

/** A scope's stylesheets: `.css` files and `.svelte` style blocks, tests excluded. `.ts`
 *  carries declarations in strings and is outside this gate; what a paint loop mints is
 *  review's. */
const sheets = (scope) =>
	under(scope, /\.(svelte|css)$/).filter((f) => !/\.(spec|test)\.(svelte|css)$/.test(f));

/** A file's CSS and the file line its first line sits on, so a finding points where the
 *  declaration is. In `.svelte` that is the `<style>` block; script and markup literals are
 *  none of a style gate's business. */
function styleOf(text, file) {
	if (!file.endsWith('.svelte')) return { css: text, base: 1 };
	const block = text.match(/<style[^>]*>([\s\S]*?)<\/style>/);
	return block ? { css: block[1], base: text.slice(0, block.index).split('\n').length } : undefined;
}

/** A parsed stylesheet, or undefined with the syntax error reported against the file. */
function parse(css, rel, base) {
	try {
		return postcss.parse(css);
	} catch (err) {
		errors.push(`${rel}:${base - 1 + (err.line ?? 1)}: ${err.reason ?? err.message}`);
		return undefined;
	}
}

/** The lines a `mint:` comment excuses: its own, and the one after it, so the escape reads
 *  the same written beside a declaration or above it. */
function mintedLines(root) {
	const out = new Map();
	root.walkComments((c) => {
		const m = c.text.match(MINT);
		if (!m) return;
		const { start, end } = c.source;
		for (let ln = start.line; ln <= end.line + 1; ln++) out.set(ln, m[1].trim());
	});
	return out;
}

/** `:where(…)` dropped and `:global(…)` unwrapped, parens counted so a nested group goes
 *  with its own wrapper. `:where` zeroes what it holds; `:global` is Svelte's compile-time
 *  marker, emitting its contents verbatim. What is left is everything that still weighs. */
function unwrap(sel) {
	let out = '';
	let i = 0;
	while (i < sel.length) {
		const isGlobal = sel.startsWith(':global(', i);
		if (isGlobal || sel.startsWith(':where(', i)) {
			const open = sel.indexOf('(', i);
			let depth = 0;
			let j = open;
			do {
				if (sel[j] === '(') depth++;
				else if (sel[j] === ')') depth--;
				j++;
			} while (j < sel.length && depth > 0);
			if (isGlobal) out += unwrap(sel.slice(open + 1, j - 1));
			i = j;
			continue;
		}
		out += sel[i++];
	}
	return out;
}

/** A class, id or attribute weighing outside `:where()` — the two columns a consumer's own
 *  class has to outrank. A pseudo-element weighs in the third, which any class already
 *  beats. */
function weighs(sel) {
	const bare = unwrap(sel)
		.replace(/::[\w-]+/g, '')
		.replace(/:(?:before|after|first-line|first-letter)\b/g, '');
	return /#[\w-]+|\.[\w-]+|\[[^\]]*\]|:[\w-]+/.test(bare);
}

/** Every selector a rule states, at the line it sits on. A `@keyframes` child states an
 *  offset rather than a selector, so its rules are skipped. */
function* selectorsOf(root) {
	const rules = [];
	root.walkRules((rule) => {
		if (rule.parent.type !== 'atrule' || !/keyframes$/i.test(rule.parent.name)) rules.push(rule);
	});
	for (const rule of rules)
		for (const sel of rule.selectors) yield { sel, line: rule.source.start.line };
}

// ── The bundle half ─────────────────────────────────────────────────────────────

if (process.argv.includes('--built')) {
	/** The built consumers in this workspace: what `quillkit studio` serves, what
	 *  `quillkit site` lays into a deploy, and what Pages holds. A third-party consumer takes
	 *  the package the same way. CI names the site laid from the tarball as an argument. */
	const bundles = [
		join(ROOT, 'packages/quillkit/dist/client'),
		join(ROOT, 'packages/playground/build'),
		...process.argv.slice(process.argv.indexOf('--built') + 1).map((a) => resolve(a))
	];
	const DEFINES = /(--[\w-]+)\s*:/g;
	const READS = /var\(\s*(--[\w-]+)/g;

	const shipped = new Set();
	for (const { at } of packages())
		for (const file of filesUnder(join(at, 'dist'), /\.css$/, { skip: bundles }))
			for (const [, name] of decomment(readFileSync(file, 'utf8')).matchAll(DEFINES))
				shipped.add(name);

	if (!shipped.size)
		errors.push('packages/*/dist: no shipped stylesheet mints a rung — run `npm run build` first');

	let measured = 0;
	for (const bundle of bundles) {
		const where = relative(ROOT, bundle) || bundle;
		if (!existsSync(bundle)) {
			errors.push(`${where}: no such directory — run \`npm run build\` first`);
			continue;
		}
		// Every text asset, not the stylesheets alone: a bundler may inline a sheet into a
		// chunk, and the paint loop carries style declarations as JS strings. The sheets are
		// the half that ships unminified, so their prose names the rungs it is about and is
		// cut; a chunk's is already gone.
		const defined = new Set();
		const read = new Map();
		for (const file of filesUnder(bundle, /\.(css|js|html)$/)) {
			const raw = readFileSync(file, 'utf8');
			const text = file.endsWith('.css') ? decomment(raw) : raw;
			for (const [, name] of text.matchAll(DEFINES)) defined.add(name);
			for (const [, name] of text.matchAll(READS)) if (!read.has(name)) read.set(name, file);
		}
		for (const [name, file] of [...read].sort((a, b) => (a[0] < b[0] ? -1 : 1)))
			if (shipped.has(name) && !defined.has(name))
				errors.push(
					`${relative(ROOT, file)}: reads \`${name}\`, which nothing in ${where} defines — ` +
						`the stylesheet that mints it was pruned out of the bundle`
				);
		measured++;
	}

	report(
		'Bundle check',
		errors,
		`Bundle OK — ${measured} bundles resolve every shipped rung they read, of the ${shipped.size} the workspace mints.`
	);
	process.exit(0);
}

// ── The source half ─────────────────────────────────────────────────────────────

const consumed = new Set();
const mints = [];
let scanned = 0;

for (const scope of SCOPES) {
	// An app reads two scales: the preset's, which is most of what it draws with, and its
	// own for what it adds on top. The package and the preset each read one.
	const reads = /^--(_qm|qmh)-$/.test(scope.prefix) ? [scope.prefix] : [scope.prefix, '--qmh-'];
	const READS_RUNG = new RegExp(`var\\((${reads.join('|')})`);
	const PRIVATE_DEF = new RegExp(`^${scope.prefix}[\\w-]+$`);
	// The axis table names the package's rungs; elsewhere the same families sit under the
	// prefix that scope draws with.
	const hint = (text) =>
		scope.prefix === '--_qm-' ? text : text.replaceAll('--_qm-', reads.at(-1));

	for (const full of sheets(scope)) {
		const rel = relative(ROOT, full);
		const region = styleOf(readFileSync(full, 'utf8'), full);
		if (!region) continue;
		const root = parse(region.css, rel, region.base);
		if (!root) continue;
		scanned++;
		const minted = mintedLines(root);
		const derivation = rel === scope.derivation;
		/** A line of the parsed CSS, as a line of the file it came out of. */
		const at = (line) => region.base - 1 + line;

		root.walkDecls((decl) => {
			const ln = at(decl.source.start.line);
			const excused = minted.get(decl.source.start.line);
			if (scope.census)
				for (const [, d] of decl.value.matchAll(/var\(\s*(--qm-[\w-]+)/g)) consumed.add(d);

			// The scale is minted in one file, and forking it is not a value to try, so the
			// escape does not reach this.
			if (!derivation && PRIVATE_DEF.test(decl.prop)) {
				errors.push(
					`${rel}:${ln}: defines \`${decl.prop}\` — the scale is minted only in ${scope.derivation}`
				);
				return;
			}
			if (derivation || excused !== undefined) {
				if (excused !== undefined) mints.push(`${rel}:${ln}: ${excused}`);
				return;
			}

			for (const axis of AXES) {
				if (!axis.props.test(decl.prop)) continue;
				const bad = axis.literal
					? axis.literal.test(decl.value)
					: axis.only
						? !axis.only.test(decl.value.trim())
						: !READS_RUNG.test(decl.value) && !axis.allowBare.test(decl.value.trim());
				if (bad)
					errors.push(
						`${rel}:${ln}: \`${decl.prop}\` ${axis.lead ?? 'mints a literal'} — ` +
							`${axis.fix ?? `read a ${hint(axis.rung)} rung`} (${scope.doc})`
					);
			}
		});

		// ── Rank ────────────────────────────────────────────────────────────────────
		// The surfaces alone: an app's own page ranks by ordinary precedence, and the preset's
		// classes land on a consumer's DOM where a rule of their own is aimed rather than
		// incidental.
		if (!scope.surface) continue;
		if (/@layer\b/.test(region.css))
			errors.push(
				`${rel}: declares a cascade layer — the surfaces rank by specificity, not by layer`
			);
		const contract = full.endsWith('.css') && !RANK_EXEMPT.includes(rel);
		for (const { sel, line } of selectorsOf(root)) {
			if (!weighs(sel)) continue;
			if (contract)
				errors.push(
					`${rel}:${at(line)}: \`${sel}\` weighs outside \`:where()\` — a consumer's own rule has to outrank it`
				);
			else if ([...sel.matchAll(CLASS_IN_SRC)].some((m) => SURFACE_CONTRACT.includes(m[0])))
				errors.push(
					`${rel}:${at(line)}: \`${sel}\` weighs on a surface's contract class — ` +
						`wrap it \`:global(:where(…))\` so a consumer's own rule wins`
				);
		}
	}
}

// ── The contract, in two directions ──────────────────────────────────────────────
// A dial a surface consumes and THEMING.md does not document cannot be set by the consumer
// it exists for, and a promised class the DOM stopped carrying is a rule aimed at nothing.
// The reverse of each is prose ahead of its code, which is how the next dial gets
// described, so it warns.

const theming = readFileSync(THEMING, 'utf8');
const documented = new Set([...theming.matchAll(/`(--qm-[\w-]+)`/g)].map((m) => m[1]));
for (const t of [...consumed].filter((t) => !documented.has(t)).sort())
	errors.push(`THEMING.md: \`${t}\` consumed but undocumented`);
for (const t of [...documented].filter((t) => !consumed.has(t)).sort())
	warnings.push(`THEMING.md: \`${t}\` documented but unconsumed`);

const classes = new Set();
for (const scope of SCOPES.filter((s) => s.census))
	for (const full of under(scope, /\.(svelte|ts|css)$/))
		for (const m of readFileSync(full, 'utf8').matchAll(CLASS_IN_SRC)) classes.add(m[0]);

const promised = new Set([...theming.matchAll(/`\.(qm-[\w-]+)`/g)].map((m) => m[1]));
for (const c of [...promised].filter((c) => !classes.has(c)).sort())
	errors.push(`THEMING.md: \`.${c}\` promised but carried by nothing in src/`);
for (const c of SURFACE_CONTRACT.filter((c) => !promised.has(c)))
	errors.push(`THEMING.md: \`.${c}\` is held at zero rank but not promised — settle which`);

// ── One name, one thing ──────────────────────────────────────────────────────────
// The preset's recipes and the surfaces' own chrome draw on one document under one `qm-`
// prefix, so a chrome element wearing a recipe's name takes that recipe in silence: a
// boolean control named `.qm-switch` stands its thumb at the pane band's touch floor,
// three times the track holding it, at the widths where the band exists. Nothing else
// sees it — the name is right in both files, the rule is right in both files, and no
// unit test computes layout. The placement handles are the overlap a consumer is told
// about, so they are the only one.

const recipes = new Set();
for (const scope of SCOPES.filter((s) => s.prefix === '--qmh-'))
	for (const full of under(scope, /\.css$/)) {
		const root = parse(readFileSync(full, 'utf8'), relative(ROOT, full), 1);
		if (!root) continue;
		for (const { sel } of selectorsOf(root))
			for (const m of sel.matchAll(CLASS_IN_SRC)) recipes.add(m[0]);
	}
for (const scope of SCOPES.filter((s) => s.surface))
	for (const full of under(scope, /\.(svelte|ts|css)$/)) {
		const worn = new Set(
			[...decomment(readFileSync(full, 'utf8')).matchAll(CLASS_IN_SRC)]
				.map((m) => m[0])
				.filter((c) => recipes.has(c) && !SURFACE_CONTRACT.includes(c))
		);
		for (const c of [...worn].sort())
			errors.push(
				`${relative(ROOT, full)}: draws \`.${c}\`, which the preset recipes for a host — ` +
					`name the chrome's own (THEMING §"The shell")`
			);
	}

report(
	'Style check',
	errors,
	`Style OK — ${scanned} sheets over ${SCOPES.length} scopes, ${consumed.size} public dials, ` +
		`${promised.size} contract classes` +
		(mints.length ? `, ${mints.length} minted on purpose.` : '.'),
	[...warnings, ...mints.map((m) => `${m} (minted on purpose)`)]
);
