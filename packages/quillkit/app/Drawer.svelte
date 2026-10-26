<!--
  "My documents": every document this browser keeps for this app, most recently edited
  first, and what can be done with each (APP §"Documents"). Closed until asked for, and
  mounted only while open, so the list is read when it opens rather than kept in step.

  A native `<dialog>` carries the top layer, the focus trap and the escape key; what is
  written here is the sheet's edge and its width.
-->
<script lang="ts">
	import type { DocRecord } from './records';

	interface Props {
		/** Undefined while the list is read, and when the browser keeps nothing. */
		records: DocRecord[] | undefined;
		/** Whether the browser keeps documents at all. */
		keeps: boolean;
		/** The record on screen, which is marked rather than offered. */
		current: string | undefined;
		onOpen: (record: DocRecord) => void;
		onDownload: (record: DocRecord) => void;
		onDelete: (record: DocRecord) => void;
		onNew: () => void;
		onClearAll: () => void;
		onClose: () => void;
	}

	let { records, keeps, current, onOpen, onDownload, onDelete, onNew, onClearAll, onClose }: Props =
		$props();

	const when = (ms: number): string =>
		new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
</script>

<dialog
	{@attach (dialog) => dialog.showModal()}
	class="drawer"
	aria-label="My documents"
	data-testid="drawer"
	onclose={onClose}
	onclick={(e) => {
		if (e.target === e.currentTarget) e.currentTarget.close();
	}}
>
	<div class="sheet">
		<header class="qm-bar top">
			<h2 class="qm-label">My documents</h2>
			<button class="qm-control" type="button" data-testid="new" onclick={onNew}>New</button>
			<button
				class="qm-control"
				type="button"
				aria-label="Close"
				onclick={(e) => e.currentTarget.closest('dialog')?.close()}>Close</button
			>
		</header>

		<p class="where">
			{keeps ? 'Saved in this browser only.' : 'This browser is keeping no documents.'}
		</p>

		{#if records?.length}
			<ul class="list" data-testid="records">
				{#each records as record (record.id)}
					<li class="row" aria-current={record.id === current ? 'true' : undefined}>
						<button class="open" type="button" onclick={() => onOpen(record)}>
							<span class="title">{record.title || 'Untitled'}</span>
							<span class="edited">{when(record.edited)}</span>
						</button>
						<button class="qm-control" type="button" onclick={() => onDownload(record)}>.md</button>
						<button class="qm-control" type="button" onclick={() => onDelete(record)}>Delete</button
						>
					</li>
				{/each}
			</ul>
			<button class="qm-control clear" type="button" onclick={onClearAll}>Clear all</button>
		{:else if records}
			<p class="empty">
				Nothing saved yet. A document is saved as soon as you start filling it in.
			</p>
		{/if}
	</div>
</dialog>

<style>
	.drawer {
		box-sizing: border-box;
		margin: 0 0 0 auto;
		padding: 0;
		width: min(var(--app-drawer), 100%);
		max-width: 100%;
		height: 100%;
		max-height: 100%;
		color: var(--qmh-ink);
		background: var(--qmh-surface);
		border: none;
		border-inline-start: var(--qmh-border-width) solid var(--qmh-border);
	}

	.drawer::backdrop {
		background: var(--qmh-scrim);
	}

	.sheet {
		display: grid;
		align-content: start;
		gap: var(--qmh-space-3);
		padding: var(--qmh-space-4);
	}

	.top h2 {
		margin-inline-end: auto;
	}

	.where,
	.empty {
		margin: 0;
		font-size: var(--qmh-text-label);
		color: var(--qmh-ink-meta);
	}

	.list {
		display: grid;
		gap: var(--qmh-space);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.row {
		display: flex;
		align-items: center;
		gap: var(--qmh-space-2);
		padding: var(--qmh-space-2);
		border-radius: var(--qmh-radius-inner);
	}

	.row[aria-current='true'] {
		background: var(--qmh-surface-hover);
	}

	.open {
		display: grid;
		flex: 1 1 auto;
		min-width: 0;
		padding: 0;
		font: inherit;
		text-align: start;
		color: inherit;
		background: none;
		border: none;
		cursor: pointer;
	}

	.title {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.edited {
		font-size: var(--qmh-text-meta);
		color: var(--qmh-ink-meta);
	}

	.clear {
		justify-self: start;
	}
</style>
