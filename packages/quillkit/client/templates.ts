// A collection's starter documents, served at `templates/` beside the quiver when the
// verb was handed a directory of them, and absent otherwise. The manifest is the one
// `quillkit` checked before serving it; what the client keeps of an entry is its name,
// its file and its sentence. A template is markdown naming its own quill, so it lands
// through the import door and nothing here reads what it holds.

export interface Template {
	name: string;
	file: string;
	description?: string;
}

const base = (): URL => new URL('templates/', document.baseURI);

/** The listed templates, or none where nothing is served: a 404, or a page answering for
 *  a file it is not. Fetched `no-cache`, since a template directory is edited in place. */
export async function listTemplates(): Promise<Template[]> {
	let entries: unknown;
	try {
		const res = await fetch(new URL('templates.json', base()), { cache: 'no-cache' });
		if (!res.ok) return [];
		entries = await res.json();
	} catch {
		return [];
	}
	if (!Array.isArray(entries)) return [];
	return entries.filter(
		(e): e is Template => typeof e?.name === 'string' && typeof e?.file === 'string'
	);
}

/** A template's markdown. */
export async function readTemplate(template: Template): Promise<string> {
	const at = new URL(template.file, base());
	const res = await fetch(at, { cache: 'no-cache' });
	if (!res.ok) throw new Error(`${template.file}: ${res.status} ${res.statusText}`);
	return res.text();
}
