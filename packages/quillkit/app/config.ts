// `app.json`, read at boot (APP §"Boot"): the tab's title and icon, and the author's
// stylesheet, linked after the client's own.
import type { AppConfig } from './records';

const at = (path: string): string => new URL(path, document.baseURI).href;

function sheet(href: string): Promise<void> {
	const link = document.createElement('link');
	link.rel = 'stylesheet';
	link.href = href;
	// Settled either way: a sheet that will not load leaves the app in its own look.
	const loaded = new Promise<void>((ok) => {
		link.onload = () => ok();
		link.onerror = () => ok();
	});
	document.head.append(link);
	return loaded;
}

export async function loadApp(): Promise<AppConfig> {
	const res = await fetch(at('app.json'), { cache: 'no-cache' });
	if (!res.ok) throw new Error(`app.json: ${res.status} ${res.statusText}`);
	const app = (await res.json()) as AppConfig;
	if (!Array.isArray(app?.quills) || app.quills.length === 0)
		throw new Error('app.json names no quill');

	document.title = app.title;
	if (app.icon) {
		const icon = document.createElement('link');
		icon.rel = 'icon';
		icon.href = at(app.icon);
		document.head.append(icon);
	}
	if (app.css) await sheet(at(app.css));
	return app;
}
