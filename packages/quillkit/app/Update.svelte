<!--
  Moving a document made on an earlier form onto the latest one (APP §"Retired pins"). The
  move re-conforms the document against a schema that may not take all of it, so it is
  never made without the document's markdown offered first, in the same place as the press
  that makes it.
-->
<script lang="ts">
	interface Props {
		onDownload: () => void;
		onUpdate: () => void;
		onClose: () => void;
	}

	let { onDownload, onUpdate, onClose }: Props = $props();
</script>

<dialog
	{@attach (dialog) => dialog.showModal()}
	class="ask"
	aria-label="Update to the latest form"
	onclose={onClose}
>
	<form method="dialog" class="plate">
		<h2 class="qm-label">Update to the latest form</h2>
		<p>
			Your answers move onto the latest version of this form. Anything it no longer asks for is
			dropped, so keep a copy of this document first.
		</p>
		<div class="qm-bar actions">
			<button class="qm-control" type="button" data-testid="keep-copy" onclick={onDownload}
				>Download .md</button
			>
			<button class="qm-control" value="cancel">Cancel</button>
			<button class="qm-app-primary" type="button" data-testid="update" onclick={onUpdate}
				>Update</button
			>
		</div>
	</form>
</dialog>

<style>
	.ask {
		padding: 0;
		max-width: min(var(--qmh-measure), 100% - var(--qmh-space-4) * 2);
		color: var(--qmh-ink);
		background: var(--qmh-surface);
		border: var(--qmh-border-width) solid var(--qmh-border);
		border-radius: var(--qmh-radius);
	}

	.ask::backdrop {
		background: var(--qmh-scrim);
	}

	.plate {
		display: grid;
		gap: var(--qmh-space-3);
		margin: 0;
		padding: var(--qmh-space-4);
	}

	.plate p {
		margin: 0;
	}

	.actions {
		justify-content: end;
	}
</style>
