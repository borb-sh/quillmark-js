<!--
 The comment panel (VISUAL_EDITOR §Comments): the threads of the editor it is seated with,
 the draft the popover's comment button started, and the verbs over each. A host mounts it
 beside the editor, over `editor.commentSeat()`; the seat is what the two share, so the panel
 holds no thread of its own and reaches the document through the editor's verbs alone.
 Replies and status go straight to the controller the seat names: they touch no anchor.
-->
<script lang="ts">
	import type { CommentThread } from '@quillmark/comments';
	import {
		DEFAULT_COMMENT_STRINGS,
		type CommentPanelStrings,
		type CommentSeat
	} from './comments.svelte.js';
	import Icon from './icons/Icon.svelte';
	import './controls.css';

	interface Props {
		/** `editor.commentSeat()`. */
		seat: CommentSeat;
		/** Partial; unset keys take the package's English. */
		strings?: Partial<CommentPanelStrings>;
		/** A store write that was refused; the index has already reverted. */
		onError?: (e: unknown) => void;
		/** Appended to the root's own class, for the layout the host owns. */
		class?: string;
	}
	let { seat, strings, onError, class: className }: Props = $props();

	const s = $derived({ ...DEFAULT_COMMENT_STRINGS, ...strings });

	/** Open threads ahead of resolved ones, each run in the store's order. */
	const ordered = $derived([
		...seat.threads.filter((t) => t.status === 'open'),
		...seat.threads.filter((t) => t.status === 'resolved')
	]);

	let draftBody = $state('');
	let replies = $state<Record<string, string>>({});
	let busy = $state(false);

	const report = (e: unknown) => (onError ? onError(e) : console.error(e));

	async function run(work: () => Promise<unknown>): Promise<void> {
		busy = true;
		try {
			await work();
		} catch (e) {
			report(e);
		} finally {
			busy = false;
		}
	}

	function submitDraft(e: SubmitEvent): void {
		e.preventDefault();
		const body = draftBody.trim();
		if (!body) return;
		void run(async () => {
			await seat.verbs?.submitDraft(body);
			draftBody = '';
		});
	}

	function submitReply(e: SubmitEvent, thread: CommentThread): void {
		e.preventDefault();
		const body = (replies[thread.id] ?? '').trim();
		if (!body || !seat.comments) return;
		const comments = seat.comments;
		void run(async () => {
			await comments.reply(thread.id, body);
			replies = { ...replies, [thread.id]: '' };
		});
	}

	function toggleStatus(thread: CommentThread): void {
		const comments = seat.comments;
		if (!comments) return;
		void run(() => comments.setStatus(thread.id, thread.status === 'open' ? 'resolved' : 'open'));
	}

	/** The draft's box takes the focus as it mounts: the button that raised it was the
	 *  popover's, which is gone. */
	function focusDraft(el: HTMLTextAreaElement): void {
		el.focus();
	}
</script>

<aside class="qm-comments {className ?? ''}" data-qm-root aria-label={s.panelLabel}>
	{#if seat.draft}
		<form class="qm-comment-card qm-comment-draft" onsubmit={submitDraft}>
			<blockquote class="qm-comment-quote">{seat.draft.quote || s.pointQuote}</blockquote>
			<textarea
				{@attach focusDraft}
				class="qm-input qm-comment-input qm-focus-ring"
				rows="3"
				placeholder={s.draftPlaceholder}
				aria-label={s.draftPlaceholder}
				bind:value={draftBody}></textarea>
			<div class="qm-comment-actions">
				<button type="submit" class="qm-icon-btn qm-focus-ring" disabled={busy || !draftBody.trim()}
					>{s.submit}</button
				>
				<button
					type="button"
					class="qm-icon-btn qm-focus-ring"
					onclick={() => seat.verbs?.discardDraft()}>{s.cancel}</button
				>
			</div>
		</form>
	{:else if !ordered.length}
		<p class="qm-comment-empty">{s.empty}</p>
	{/if}
	{#each ordered as thread (thread.id)}
		<article
			class="qm-comment-card"
			data-active={seat.active === thread.id || undefined}
			data-status={thread.status}
			data-anchored={thread.anchored || undefined}
		>
			<button
				type="button"
				class="qm-comment-quote-btn qm-focus-ring"
				title={s.goTo}
				onclick={() => void seat.verbs?.focusThread(thread.id)}
			>
				<Icon name="message-square" />
				<blockquote class="qm-comment-quote">{thread.selector.quote || s.pointQuote}</blockquote>
			</button>
			{#if thread.status === 'resolved' || !thread.anchored || seat.drifted.includes(thread.id)}
				<div class="qm-comment-chips">
					{#if thread.status === 'resolved'}<span class="qm-chip">{s.resolved}</span>{/if}
					{#if !thread.anchored}<span class="qm-chip">{s.unanchored}</span>{/if}
					{#if seat.drifted.includes(thread.id)}<span class="qm-chip">{s.drifted}</span>{/if}
				</div>
			{/if}
			<ol class="qm-comment-messages">
				{#each thread.messages as m (m.id)}
					<li class="qm-comment-message">
						<span class="qm-comment-author">{m.author.name}</span>
						<time class="qm-comment-time" datetime={m.createdAt}>{s.when(m.createdAt)}</time>
						<p class="qm-comment-body">{m.body}</p>
					</li>
				{/each}
			</ol>
			<form class="qm-comment-reply" onsubmit={(e) => submitReply(e, thread)}>
				<textarea
					class="qm-input qm-comment-input qm-focus-ring"
					rows="2"
					placeholder={s.replyPlaceholder}
					aria-label={s.replyPlaceholder}
					bind:value={replies[thread.id]}></textarea>
				<div class="qm-comment-actions">
					<button
						type="submit"
						class="qm-icon-btn qm-focus-ring"
						disabled={busy || !(replies[thread.id] ?? '').trim()}>{s.reply}</button
					>
					<button
						type="button"
						class="qm-icon-btn qm-focus-ring"
						disabled={busy}
						onclick={() => toggleStatus(thread)}
						>{thread.status === 'open' ? s.resolve : s.reopen}</button
					>
					{#if !thread.anchored}
						<button
							type="button"
							class="qm-icon-btn qm-focus-ring"
							disabled={busy}
							onclick={() =>
								void run(() => seat.verbs?.reanchorThread(thread.id) ?? Promise.resolve())}
							>{s.reanchor}</button
						>
					{/if}
					<button
						type="button"
						class="qm-icon-btn qm-comment-remove qm-focus-ring"
						disabled={busy}
						title={s.remove}
						aria-label={s.remove}
						onclick={() => void run(() => seat.verbs?.removeThread(thread.id) ?? Promise.resolve())}
						><Icon name="trash-2" /></button
					>
				</div>
			</form>
		</article>
	{/each}
</aside>

<style>
	/* A column of cards in the editor's own rhythm. The root carries the marker, so the
	   derivation reaches it wherever the host mounts it (core/theme.css). */
	.qm-comments {
		display: flex;
		flex-direction: column;
		gap: var(--_qm-space-2);
		font-family: var(--_qm-font);
		font-size: var(--_qm-text-body);
		line-height: var(--_qm-leading-body);
		color: var(--_qm-ink);
	}
	.qm-comment-card {
		display: flex;
		flex-direction: column;
		gap: var(--_qm-space);
		padding: var(--_qm-space-3);
		border: var(--_qm-border-width) solid var(--_qm-border);
		border-radius: var(--_qm-radius);
		background: var(--_qm-surface);
	}
	/* The active thread wears the comment hue at its edge, the one the text wears under
	   the caret. A resolved thread recedes, as its anchor does. */
	.qm-comment-card[data-active] {
		border-color: var(--_qm-comment);
	}
	.qm-comment-card[data-status='resolved'] {
		opacity: var(--_qm-opacity-muted);
	}
	.qm-comment-quote-btn {
		display: flex;
		align-items: flex-start;
		gap: var(--_qm-space);
		padding: 0;
		border: 0;
		background: none;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.qm-comment-quote {
		margin: 0;
		padding-left: var(--_qm-space-2);
		border-left: calc(var(--_qm-border-width) * 2) solid var(--_qm-comment);
		color: var(--_qm-ink-label);
		font-size: var(--_qm-text-label);
		overflow-wrap: anywhere;
	}
	.qm-comment-chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--_qm-space-half);
	}
	.qm-comment-messages {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: var(--_qm-space-2);
	}
	.qm-comment-author {
		font-weight: var(--_qm-weight-strong);
	}
	.qm-comment-time {
		margin-left: var(--_qm-space);
		color: var(--_qm-ink-label);
		font-size: var(--_qm-text-label);
	}
	.qm-comment-body {
		margin: 0;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.qm-comment-reply,
	.qm-comment-draft {
		display: flex;
		flex-direction: column;
		gap: var(--_qm-space);
	}
	.qm-comment-input {
		resize: vertical;
		font: inherit;
	}
	.qm-comment-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--_qm-space-half);
	}
	.qm-comment-remove {
		margin-left: auto;
		color: var(--_qm-danger);
	}
	.qm-comment-empty {
		margin: 0;
		color: var(--_qm-ink-label);
	}
</style>
