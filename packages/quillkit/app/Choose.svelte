<!--
  The landing an app with several quills opens on: one card per quill, its title and its
  sentence, and a press starts a blank document on it (APP §"The first screen").
-->
<script lang="ts">
	import type { AppQuill } from './records';

	interface Props {
		description?: string;
		quills: AppQuill[];
		onPick: (quill: AppQuill) => void;
	}

	let { description, quills, onPick }: Props = $props();
</script>

<div class="choose">
	{#if description}
		<p class="lead">{description}</p>
	{/if}
	<ul class="cards" aria-label="Forms">
		{#each quills as quill (quill.ref)}
			<li>
				<button class="card" type="button" data-testid="pick" onclick={() => onPick(quill)}>
					<span class="name">{quill.title}</span>
					{#if quill.description}
						<span class="said">{quill.description}</span>
					{/if}
				</button>
			</li>
		{/each}
	</ul>
</div>

<style>
	.choose {
		min-height: 0;
		overflow: auto;
		padding: var(--qmh-space-4);
	}

	.lead {
		max-width: var(--qmh-measure);
		margin: 0 0 var(--qmh-space-4);
		color: var(--qmh-ink-meta);
	}

	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(var(--app-card), 100%), 1fr));
		gap: var(--qmh-space-4);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	/* A card is one press: the whole plate is the control, so nothing on it is a second
	   target. */
	.card {
		box-sizing: border-box;
		display: grid;
		align-content: start;
		gap: var(--qmh-space-2);
		width: 100%;
		height: 100%;
		padding: var(--qmh-space-4);
		font: inherit;
		text-align: start;
		color: var(--qmh-ink);
		background: var(--qmh-surface);
		border: var(--qmh-border-width) solid var(--qmh-border);
		border-radius: var(--qmh-radius);
		cursor: pointer;
		transition: border-color var(--qmh-duration) var(--qmh-ease-reverse);
	}

	.card:hover {
		border-color: var(--qmh-border-strong);
	}

	.name {
		font-weight: var(--qmh-weight-strong);
	}

	.said {
		font-size: var(--qmh-text-label);
		color: var(--qmh-ink-meta);
	}
</style>
