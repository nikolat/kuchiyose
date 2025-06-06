<script lang="ts">
	import { page } from '$app/state';
	import { getEmoji, getEmojiMap, isValidDTag } from '$lib/utils';
	import type { NostrEvent } from 'nostr-tools/pure';

	let {
		isOpenEdit = $bindable(),
		editDTag = $bindable(),
		editTitleTag = $bindable(),
		editTag = $bindable(),
		editTags = $bindable(),
		editContent = $bindable(),
		editContentTextArea = $bindable(),
		isContentWarningEnabled = $bindable(),
		contentWarningReason = $bindable(),
		loginPubkey,
		eventsEmojiSet,
		sendWebBookmark
	}: {
		isOpenEdit: boolean;
		editDTag: string;
		editTitleTag: string;
		editTag: string;
		editTags: string[];
		editContent: string;
		editContentTextArea: HTMLTextAreaElement | undefined;
		isContentWarningEnabled: boolean;
		contentWarningReason: string;
		loginPubkey: string | undefined;
		eventsEmojiSet: NostrEvent[];
		sendWebBookmark: () => Promise<void>;
	} = $props();

	const urlSearchParams: URLSearchParams = $derived(page.url.searchParams);

	$effect(() => {
		const editTagsSet = new Set<string>();
		for (const [k, v] of urlSearchParams.entries()) {
			switch (k) {
				case 'd':
					editDTag = v;
					break;
				case 'title':
					editTitleTag = v;
					break;
				case 't':
					if (/[^\s#]+/.test(v)) {
						editTagsSet.add(v.toLowerCase());
					}
					break;
				case 'content':
					editContent = v;
					break;
				default:
					break;
			}
		}
		editTags = Array.from(editTagsSet);
		if (urlSearchParams.size > 0) {
			isOpenEdit = true;
		}
	});

	let editTagInput: HTMLInputElement | undefined = $state();
	let emojiPickerContainer: HTMLElement | undefined = $state();
	const insertText = (word: string, enableNewline: boolean = true): void => {
		if (editContentTextArea === undefined) {
			return;
		}
		let sentence = editContentTextArea.value;
		const len = sentence.length;
		const pos = editContentTextArea.selectionStart;
		const before = sentence.slice(0, pos);
		const after = sentence.slice(pos, pos + len);
		if (enableNewline && !(before.length === 0 || before.endsWith('\n'))) {
			word = `\n${word}`;
		}
		sentence = before + word + after;
		editContentTextArea.value = sentence;
		editContentTextArea.focus();
		editContentTextArea.selectionStart = pos + word.length;
		editContentTextArea.selectionEnd = pos + word.length;
		editContent = sentence;
	};
	const callGetEmoji = () => {
		if (emojiPickerContainer === undefined) {
			return;
		}
		if (emojiPickerContainer.children.length > 0) {
			return;
		}
		getEmoji(
			emojiPickerContainer,
			getEmojiMap(eventsEmojiSet),
			false,
			async (emojiStr: string, _emojiUrl: string | undefined): Promise<void> => {
				insertText(emojiStr, false);
			}
		);
	};
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
				class={editDTag.length === 0 || isValidDTag(editDTag) ? 'valid' : 'invalid'}
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
					type="button"
					class="svg category-delete"
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
			{#if isContentWarningEnabled}
				<input
					id="edit-content-warning-reason"
					type="text"
					placeholder="Reason for warning (optional)"
					disabled={loginPubkey === undefined}
					bind:value={contentWarningReason}
				/>
			{/if}
			<textarea
				id="edit-comment"
				disabled={loginPubkey === undefined}
				bind:value={editContent}
				bind:this={editContentTextArea}
			></textarea>
			<span class="add-cw">
				<button
					type="button"
					class="svg add-cw"
					aria-label="add cw"
					title="add content warning"
					disabled={loginPubkey === undefined}
					onclick={() => {
						isContentWarningEnabled = !isContentWarningEnabled;
					}}
				>
					<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
						<path
							fill-rule="evenodd"
							d="M15.4362056,3.97761907 L22.4415418,15.9531803 C23.1705647,17.1855523 23.1862871,18.7132183 22.4827809,19.960327 C21.7784409,21.2089137 20.4619131,21.9842458 19.0122617,21.9983464 L4.97439311,21.9982802 C3.53965557,21.9866122 2.22062199,21.2088986 1.51617253,19.9591997 C0.812307653,18.7105379 0.82874719,17.1794759 1.55542122,15.9576183 L8.56335758,3.97766866 C9.27539851,2.75195566 10.5866895,1.99834312 12.0044595,2.00000273 C13.4220774,2.00166216 14.7329114,2.75839786 15.4362056,3.97761907 Z M10.2912062,4.98490751 L3.27807854,16.973689 C2.91426165,17.5854502 2.90603166,18.3519329 3.25843298,18.9770956 C3.61122214,19.6029463 4.27192295,19.9925012 4.98252774,19.9983133 L19.0025048,19.998394 C19.7286764,19.9913068 20.3881019,19.6029566 20.7408294,18.977675 C21.0930548,18.3532834 21.0851837,17.588488 20.7176978,16.9672502 L13.7068317,4.98222313 C13.357551,4.37673307 12.7063962,4.00082577 12.0021183,4.00000136 C11.2977596,3.99917685 10.6463678,4.37353845 10.2912062,4.98490751 Z M12.0003283,17.9983464 C11.4478622,17.9983464 11,17.5506311 11,16.9983464 C11,16.4460616 11.4478622,15.9983464 12.0003283,15.9983464 C12.5527943,15.9983464 13.0006565,16.4460616 13.0006565,16.9983464 C13.0006565,17.5506311 12.5527943,17.9983464 12.0003283,17.9983464 Z M11.0029544,7.99834639 L13.0036109,7.99834639 L13.0036109,14.9983464 L11.0029544,14.9983464 L11.0029544,7.99834639 Z"
						/>
					</svg>
				</button>
			</span>
			<span class="add-emoji">
				<button
					type="button"
					class="svg add-emoji"
					aria-label="add emoji"
					title="add emoji"
					disabled={loginPubkey === undefined}
					onclick={callGetEmoji}
				>
					<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
						<path
							fill-rule="evenodd"
							d="M12,23 C5.92486775,23 1,18.0751322 1,12 C1,5.92486775 5.92486775,1 12,1 C18.0751322,1 23,5.92486775 23,12 C23,18.0751322 18.0751322,23 12,23 Z M12,21 C16.9705627,21 21,16.9705627 21,12 C21,7.02943725 16.9705627,3 12,3 C7.02943725,3 3,7.02943725 3,12 C3,16.9705627 7.02943725,21 12,21 Z M15.2746538,14.2978292 L16.9105622,15.4483958 C15.7945475,17.0351773 13.9775544,18 12,18 C10.0224456,18 8.20545254,17.0351773 7.08943782,15.4483958 L8.72534624,14.2978292 C9.4707028,15.3575983 10.6804996,16 12,16 C13.3195004,16 14.5292972,15.3575983 15.2746538,14.2978292 Z M14,11 L14,9 L16,9 L16,11 L14,11 Z M8,11 L8,9 L10,9 L10,11 L8,11 Z"
						/>
					</svg>
				</button>
			</span>
			<div class="emoji-picker-container" bind:this={emojiPickerContainer}></div>
		</dd>
		<dt class="submit">Submit</dt>
		<dd class="submit">
			<button
				type="button"
				disabled={loginPubkey === undefined || !isValidDTag(editDTag)}
				onclick={sendWebBookmark}>Submit</button
			>
		</dd>
	</dl>
</details>

<style>
	summary {
		width: 100%;
	}
	dl.edit input {
		min-width: 18em;
	}
	dd.d-tag input {
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
	dd.content {
		position: relative;
	}
	.content > span {
		margin-right: 20px;
	}
	.emoji-picker-container {
		margin-left: -40px;
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
	button.svg > svg {
		width: 16px;
		height: 16px;
		fill: var(--text-bright);
	}
	button.svg:active > svg {
		fill: yellow;
	}
	#edit-content-warning-reason ~ span.add-cw > button.svg.add-cw > svg {
		fill: yellow;
	}
	button.category-delete {
		vertical-align: sub;
	}
	button.category-add {
		margin-top: 7px;
		height: 24px;
	}
	button.category-add > svg {
		width: 24px;
		height: 24px;
	}
</style>
