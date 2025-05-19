<script lang="ts">
	import { isValidWebBookmark } from '$lib/utils';

	let {
		isOpenEdit = $bindable(),
		editDTag = $bindable(),
		editTitleTag = $bindable(),
		editTag = $bindable(),
		editTags = $bindable(),
		editTagInput = $bindable(),
		editContent = $bindable(),
		loginPubkey,
		sendWebBookmark
	}: {
		isOpenEdit: boolean;
		editDTag: string;
		editTitleTag: string;
		editTag: string;
		editTags: string[];
		editTagInput: HTMLInputElement | undefined;
		editContent: string;
		loginPubkey: string | undefined;
		sendWebBookmark: () => Promise<void>;
	} = $props();
</script>

<details class="edit" bind:open={isOpenEdit}>
	<summary>create new web bookmark</summary>
	<dl class="edit">
		<dt class="d-tag">
			<label for="edit-url">URL(d-tag)</label>
		</dt>
		<dd class="d-tag">
			https://<input
				id="edit-url"
				class={editDTag.length === 0 || isValidWebBookmark(editDTag) ? 'valid' : 'invalid'}
				type="text"
				placeholder="example.com/"
				disabled={loginPubkey === undefined}
				bind:value={editDTag}
				onpaste={(e: ClipboardEvent & { currentTarget: EventTarget & HTMLInputElement }) => {
					const pastedText = e.clipboardData?.getData('text/plain');
					if (pastedText?.startsWith('https://')) {
						e.preventDefault();
						editDTag = pastedText.replace(/^https:\/\//, '');
					}
				}}
			/>
		</dd>
		<dt class="title-tag">
			<label for="edit-title">Title(title-tag)</label>
		</dt>
		<dd class="title-tag">
			<input
				id="edit-title"
				type="text"
				disabled={loginPubkey === undefined}
				bind:value={editTitleTag}
			/>
		</dd>
		<dt class="t-tag">
			<label for="edit-category">Category(t-tag)</label>
			{#each editTags as tTag (tTag)}
				<span class="category-tag">#{tTag}</span><button
					class="svg category-delete"
					type="button"
					title="delete the category"
					aria-label="delete the category"
					disabled={loginPubkey === undefined}
					onclick={() => {
						editTags = editTags.filter((t) => t !== tTag);
					}}
				>
					<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
						<path
							fill-rule="evenodd"
							d="M12,23 C5.92486775,23 1,18.0751322 1,12 C1,5.92486775 5.92486775,1 12,1 C18.0751322,1 23,5.92486775 23,12 C23,18.0751322 18.0751322,23 12,23 Z M12,21 C16.9705627,21 21,16.9705627 21,12 C21,7.02943725 16.9705627,3 12,3 C7.02943725,3 3,7.02943725 3,12 C3,16.9705627 7.02943725,21 12,21 Z M12,13.4142136 L8.70710678,16.7071068 L7.29289322,15.2928932 L10.5857864,12 L7.29289322,8.70710678 L8.70710678,7.29289322 L12,10.5857864 L15.2928932,7.29289322 L16.7071068,8.70710678 L13.4142136,12 L16.7071068,15.2928932 L15.2928932,16.7071068 L12,13.4142136 Z"
						/>
					</svg>
				</button>
			{/each}
		</dt>
		<dd class="t-tag">
			<input
				id="edit-category"
				type="text"
				disabled={loginPubkey === undefined}
				pattern="[^\s#]+"
				bind:value={editTag}
				bind:this={editTagInput}
			/>
			<button
				type="button"
				class="svg category-add"
				title="add"
				aria-label="add"
				disabled={loginPubkey === undefined ||
					editTag.length === 0 ||
					editTagInput.validity.patternMismatch ||
					editTags.includes(editTag.toLowerCase())}
				onclick={() => {
					editTags.push(editTag.toLowerCase());
					editTag = '';
					editTagInput?.focus();
				}}
			>
				<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
					<path
						fill-rule="evenodd"
						d="M12,23 C5.92486775,23 1,18.0751322 1,12 C1,5.92486775 5.92486775,1 12,1 C18.0751322,1 23,5.92486775 23,12 C23,18.0751322 18.0751322,23 12,23 Z M12,21 C16.9705627,21 21,16.9705627 21,12 C21,7.02943725 16.9705627,3 12,3 C7.02943725,3 3,7.02943725 3,12 C3,16.9705627 7.02943725,21 12,21 Z M13,11 L17,11 L17,13 L13,13 L13,17 L11,17 L11,13 L7,13 L7,11 L11,11 L11,7 L13,7 L13,11 Z"
					/>
				</svg>
			</button>
		</dd>
		<dt class="content">
			<label for="edit-comment">Comment(content)</label>
		</dt>
		<dd class="content">
			<textarea id="edit-comment" disabled={loginPubkey === undefined} bind:value={editContent}
			></textarea>
		</dd>
		<dt class="submit">Submit</dt>
		<dd class="submit">
			<button
				type="button"
				disabled={loginPubkey === undefined || !isValidWebBookmark(editDTag)}
				onclick={sendWebBookmark}>Submit</button
			>
		</dd>
	</dl>
</details>

<style>
	summary {
		width: 100%;
	}
	dl.edit input,
	dl.edit textarea {
		min-width: 15em;
	}
	.d-tag {
		line-height: 2.5em;
	}
	.d-tag > input,
	.t-tag > input {
		display: inline-block;
	}
	input#edit-category:invalid,
	input.invalid {
		outline: 2px solid red;
	}
	.category-tag {
		margin-left: 0.5em;
	}
	button.svg {
		border: none;
		outline: none;
		padding: 0;
		height: 16px;
		margin: 0;
		background-color: rgba(127, 127, 127, 0);
		border-radius: 10%;
	}
	button.category-delete {
		vertical-align: sub;
	}
	button.category-add {
		margin-top: 7px;
	}
	button.svg > svg {
		width: 16px;
		height: 16px;
		fill: var(--text-bright);
	}
	button.category-add {
		height: 24px;
	}
	button.category-add > svg {
		width: 24px;
		height: 24px;
	}
</style>
