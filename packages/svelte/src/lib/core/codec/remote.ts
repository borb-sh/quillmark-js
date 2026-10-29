// A transaction that lands what another writer committed: the store already holds it, so no
// filter refuses it, and history maps the local steps through it rather than recording it.
import { PluginKey, type Transaction } from 'prosemirror-state';

export const remoteKey = new PluginKey('quill-remote');

export function isRemote(tr: Transaction): boolean {
	return tr.getMeta(remoteKey) === true;
}
