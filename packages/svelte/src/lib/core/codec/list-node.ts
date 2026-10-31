import type { Node as PMNode } from 'prosemirror-model';

export const isList = (node: PMNode | null | undefined): node is PMNode =>
	!!node && (node.type.name === 'ordered_list' || node.type.name === 'bullet_list');
