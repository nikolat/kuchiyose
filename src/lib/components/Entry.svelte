<script lang="ts">
	import { getRoboHashURL } from '$lib/config';
	import {
		getDateTimeString,
		getEmoji,
		getEmojiMap,
		getEventsReactionToTheTarget
	} from '$lib/utils';
	import type { NostrEvent } from 'nostr-tools/pure';
	import { isAddressableKind, isRegularKind, isReplaceableKind } from 'nostr-tools/kinds';
	import * as nip19 from 'nostr-tools/nip19';
	import {
		encodeDecodeResult,
		getAddressPointerForEvent,
		getContentWarning,
		getCoordinateFromAddressPointer,
		getPointerForEvent,
		getTagValue,
		type ProfileContent
	} from 'applesauce-core/helpers';
	import Content from '$lib/components/Content.svelte';
	import AddStar from '$lib/components/AddStar.svelte';
	import Entry from '$lib/components/Entry.svelte';

	const {
		event,
		eventsComment,
		level,
		idReferenced,
		getSeenOn,
		fork,
		sendComment,
		sendReaction,
		sendDeletion,
		loginPubkey,
		profileMap,
		eventsReaction,
		eventsEmojiSet,
		eventsQuoted,
		isSingleEntryPage,
		isQuote
	}: {
		event: NostrEvent;
		eventsComment: NostrEvent[];
		level: number;
		idReferenced: string | undefined;
		getSeenOn: (id: string, excludeWs: boolean) => string[];
		fork: (event: NostrEvent) => void;
		sendComment: (
			content: string,
			targetEventToReply: NostrEvent,
			contentWarning: string | boolean
		) => Promise<void>;
		sendReaction: (event: NostrEvent, content?: string, emojiurl?: string) => Promise<void>;
		sendDeletion: (event: NostrEvent) => Promise<void>;
		loginPubkey: string | undefined;
		profileMap: Map<string, ProfileContent>;
		eventsReaction: NostrEvent[];
		eventsEmojiSet: NostrEvent[];
		eventsQuoted: NostrEvent[];
		isSingleEntryPage: boolean;
		isQuote?: boolean;
	} = $props();

	let isDetailsVisible: boolean = $state(false);
	let isCommentFormVisible: boolean = $state(false);
	let isContentWarningVisible: boolean = $state(false);
	let editComment: string = $state('');
	const cwInit: string | boolean = getContentWarning(event);
	let isContentWarningEnabled: boolean = $state(!!cwInit);
	let contentWarningReason: string = $state(typeof cwInit === 'string' ? cwInit : '');

	const hashtags = $derived(
		new Set<string>(
			event.tags
				.filter((tag) => tag.length >= 2 && tag[0] === 't')
				.map((tag) => tag[1].toLowerCase())
		)
	);
	const prof = $derived(profileMap.get(event.pubkey));
	const contentWarning: string | boolean = $derived(getContentWarning(event));
	const commentsToTheEvent = $derived.by(() => {
		let filter: (ev: NostrEvent) => boolean;
		if (isRegularKind(event.kind)) {
			filter = (ev: NostrEvent) => getTagValue(ev, 'e') === event.id;
		} else if (isReplaceableKind(event.kind)) {
			const ap: nip19.AddressPointer = { identifier: '', ...event };
			filter = (ev: NostrEvent) => getTagValue(ev, 'a') === getCoordinateFromAddressPointer(ap);
		} else if (isAddressableKind(event.kind)) {
			const ap: nip19.AddressPointer = getAddressPointerForEvent(event);
			filter = (ev: NostrEvent) => getTagValue(ev, 'a') === getCoordinateFromAddressPointer(ap);
		} else {
			return [];
		}
		return eventsComment.filter(filter);
	});
	const classNames: string[] = $derived.by(() => {
		const classNames: string[] = ['tree'];
		if (level > 0) {
			classNames.push('comment');
		}
		if (level > 0 && level % 2 === 0) {
			classNames.push('even');
		} else if (level % 2 === 1) {
			classNames.push('odd');
		}
		if (event.id === idReferenced) {
			classNames.push('referenced');
		}
		if (isSingleEntryPage) {
			classNames.push('is-single');
		}
		if (isQuote) {
			classNames.push('is-quote');
		}
		return classNames;
	});

	const getEncode = (event: NostrEvent, relays?: string[]) =>
		encodeDecodeResult(getPointerForEvent(event, relays));

	let emojiPickerContainer: HTMLElement | undefined = $state();
	let editCommentTextArea: HTMLTextAreaElement | undefined = $state();
	const insertText = (word: string, enableNewline: boolean = true): void => {
		if (editCommentTextArea === undefined) {
			return;
		}
		let sentence = editCommentTextArea.value;
		const len = sentence.length;
		const pos = editCommentTextArea.selectionStart;
		const before = sentence.slice(0, pos);
		const after = sentence.slice(pos, pos + len);
		if (enableNewline && !(before.length === 0 || before.endsWith('\n'))) {
			word = `\n${word}`;
		}
		sentence = before + word + after;
		editCommentTextArea.value = sentence;
		editCommentTextArea.focus();
		editCommentTextArea.selectionStart = pos + word.length;
		editCommentTextArea.selectionEnd = pos + word.length;
		editComment = sentence;
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

<div class={classNames.join(' ')}>
	<div class="entry">
		<div class="avatar">
			<a href="/{nip19.npubEncode(event.pubkey)}">
				<img src={prof?.picture ?? getRoboHashURL(event.pubkey)} alt="" class="avatar" />
			</a>
		</div>
		<div class="contents">
			<div class="note">
				<div class="name">
					<a class="name" href="/{nip19.npubEncode(event.pubkey)}"
						>@{prof?.name ?? `${nip19.npubEncode(event.pubkey).slice(0, 15)}...`}</a
					><span class="hashtags">
						{#each hashtags as hashtag (hashtag)}
							<a href="/t/{encodeURI(hashtag)}" class="hashtag">#{hashtag}</a>
						{/each}
					</span>
				</div>
				<div class="content">
					{#if contentWarning && !isContentWarningVisible}
						<div class="content-warning">
							{contentWarning === true ? '⚠️Content Warning⚠️' : `⚠️${contentWarning}`}
						</div>
					{:else}
						<Content
							content={event.content}
							tags={event.tags}
							{eventsComment}
							{level}
							{idReferenced}
							{getSeenOn}
							{fork}
							{sendComment}
							{sendReaction}
							{sendDeletion}
							{loginPubkey}
							{profileMap}
							{eventsReaction}
							{eventsEmojiSet}
							{eventsQuoted}
							{isSingleEntryPage}
						/>
					{/if}
					{#if getContentWarning(event)}
						<div class="toggle-content-warning">
							<button
								type="button"
								class="toggle-content-warning"
								onclick={() => {
									isContentWarningVisible = !isContentWarningVisible;
								}}>{isContentWarningVisible ? 'Hide' : 'Show'} Content</button
							>
						</div>
					{/if}
				</div>
			</div>
			<div class="menu">
				<a href="/{getEncode(event, getSeenOn(event.id, true))}">
					<time datetime={new Date(1000 * event.created_at).toISOString()} class="created_at"
						>{getDateTimeString(event.created_at)}</time
					>
				</a>
				<AddStar
					sendReaction={(content?: string, emojiurl?: string) =>
						sendReaction(event, content, emojiurl)}
					{sendDeletion}
					{loginPubkey}
					{profileMap}
					eventsReaction={getEventsReactionToTheTarget(event, eventsReaction)}
					{eventsEmojiSet}
				/>
			</div>
			<div class="command">
				{#if loginPubkey !== undefined}
					{#if [1111, 39701].includes(event.kind)}
						<span class="show-comment-form">
							<button
								type="button"
								class="svg show-comment-form"
								title="show comment form"
								aria-label="show comment form"
								onclick={() => {
									isCommentFormVisible = !isCommentFormVisible;
								}}
							>
								<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
									<path
										fill-rule="evenodd"
										d="M12.0867962,18 L6,21.8042476 L6,18 L4,18 C2.8954305,18 2,17.1045695 2,16 L2,4 C2,2.8954305 2.8954305,2 4,2 L20,2 C21.1045695,2 22,2.8954305 22,4 L22,16 C22,17.1045695 21.1045695,18 20,18 L12.0867962,18 Z M8,18.1957524 L11.5132038,16 L20,16 L20,4 L4,4 L4,16 L8,16 L8,18.1957524 Z"
									/>
								</svg>
							</button>
						</span>
					{/if}
					{#if event.kind === 39701}
						<span class="fork">
							<button
								type="button"
								class="svg fork"
								title="fork"
								aria-label="fork"
								onclick={() => {
									fork(event);
								}}
							>
								<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
									<path
										fill-rule="evenodd"
										d="M16,16 L16,20 C16,21.1522847 15.1522847,22 14,22 L4,22 C2.84771525,22 2,21.1522847 2,20 L2,10 C2,8.84771525 2.84771525,8 4,8 L8,8 L8,4 C8,2.84771525 8.84771525,2 10,2 L20,2 C21.1522847,2 22,2.84771525 22,4 L22,14 C22,15.1522847 21.1522847,16 20,16 L16,16 Z M14,16 L10,16 C8.84771525,16 8,15.1522847 8,14 L8,10 L4,10 L4,20 L14,20 L14,16 Z M10,4 L10,14 L20,14 L20,4 L10,4 Z"
									/>
								</svg>
							</button>
						</span>
					{/if}
					{#if loginPubkey === event.pubkey && ![5, 62].includes(event.kind)}
						<span class="event-delete">
							<button
								type="button"
								class="svg event-delete"
								title="delete the event"
								aria-label="delete the event"
								onclick={async () => {
									await sendDeletion(event);
								}}
							>
								<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
									<path
										fill-rule="evenodd"
										d="M7,4 L7,3 C7,1.8954305 7.8954305,1 9,1 L15,1 C16.1045695,1 17,1.8954305 17,3 L17,4 L20,4 C21.1045695,4 22,4.8954305 22,6 L22,8 C22,9.1045695 21.1045695,10 20,10 L19.9198662,10 L19,21 C19,22.1045695 18.1045695,23 17,23 L7,23 C5.8954305,23 5,22.1045695 5.00345424,21.0830455 L4.07986712,10 L4,10 C2.8954305,10 2,9.1045695 2,8 L2,6 C2,4.8954305 2.8954305,4 4,4 L7,4 Z M7,6 L4,6 L4,8 L20,8 L20,6 L17,6 L7,6 Z M6.08648886,10 L7,21 L17,21 L17.0034542,20.9169545 L17.9132005,10 L6.08648886,10 Z M15,4 L15,3 L9,3 L9,4 L15,4 Z"
									/>
								</svg>
							</button>
						</span>
					{/if}
				{/if}
				<span class="show-details">
					<button
						type="button"
						class="svg show-details"
						title="show details"
						aria-label="show details"
						onclick={() => {
							isDetailsVisible = !isDetailsVisible;
						}}
					>
						<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
							<path
								fill-rule="evenodd"
								d="M5,14 C3.8954305,14 3,13.1045695 3,12 C3,10.8954305 3.8954305,10 5,10 C6.1045695,10 7,10.8954305 7,12 C7,13.1045695 6.1045695,14 5,14 Z M12,14 C10.8954305,14 10,13.1045695 10,12 C10,10.8954305 10.8954305,10 12,10 C13.1045695,10 14,10.8954305 14,12 C14,13.1045695 13.1045695,14 12,14 Z M19,14 C17.8954305,14 17,13.1045695 17,12 C17,10.8954305 17.8954305,10 19,10 C20.1045695,10 21,10.8954305 21,12 C21,13.1045695 20.1045695,14 19,14 Z"
							/>
						</svg>
					</button>
				</span>
			</div>
			{#if isCommentFormVisible}
				<div class="comment-form">
					{#if isContentWarningEnabled}
						<input
							type="text"
							class="reason"
							placeholder="Reason for warning (optional)"
							disabled={loginPubkey === undefined}
							bind:value={contentWarningReason}
						/>
					{/if}
					<textarea
						class="comment"
						disabled={loginPubkey === undefined}
						bind:value={editComment}
						bind:this={editCommentTextArea}
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
					<button
						type="button"
						class="send-comment"
						disabled={loginPubkey === undefined || editComment.length === 0}
						onclick={async () => {
							let cw: string | boolean;
							if (isContentWarningEnabled) {
								if (contentWarningReason.length > 0) {
									cw = contentWarningReason;
								} else {
									cw = true;
								}
							} else {
								cw = false;
							}
							const content = editComment;
							editComment = '';
							isContentWarningEnabled = !!cwInit;
							contentWarningReason = typeof cwInit === 'string' ? cwInit : '';
							isCommentFormVisible = false;
							await sendComment(content, event, cw);
						}}>Submit</button
					>
				</div>
			{/if}
			{#if isDetailsVisible}
				<div class="details">
					<details class="details" bind:open={isDetailsVisible}>
						<summary>Details</summary>
						<dl class="details">
							<dt>User ID</dt>
							<dd><code>{nip19.npubEncode(event.pubkey)}</code></dd>
							<dt>Event ID</dt>
							<dd><code>{getEncode(event)}</code></dd>
							<dt>Event JSON</dt>
							<dd>
								<pre class="json-view"><code>{JSON.stringify(event, undefined, 2)}</code></pre>
							</dd>
							<dt>Relays seen on</dt>
							<dd>
								<ul>
									{#each getSeenOn(event.id, false) as relay (relay)}
										<li>{relay}</li>
									{/each}
								</ul>
							</dd>
							<dt>Event ID with relay hints</dt>
							<dd><code>{getEncode(event, getSeenOn(event.id, false))}</code></dd>
						</dl>
					</details>
				</div>
			{/if}
		</div>
	</div>
	<div class="comments">
		{#each commentsToTheEvent as comment (comment.id)}
			<Entry
				event={comment}
				{eventsComment}
				level={level + 1}
				{idReferenced}
				{getSeenOn}
				{fork}
				{sendComment}
				{sendReaction}
				{sendDeletion}
				{loginPubkey}
				{profileMap}
				{eventsReaction}
				{eventsEmojiSet}
				{eventsQuoted}
				{isSingleEntryPage}
			/>
		{/each}
	</div>
</div>

<style>
	.entry {
		display: flex;
		margin-bottom: 0.5em;
	}
	.tree {
		margin-top: 5px;
	}
	.tree:not(.is-single):not(.is-quote) > .entry > .contents > .note {
		max-height: 30em;
		overflow-y: auto;
	}
	.tree:not(.comment) > .entry {
		margin-top: 1em;
	}
	.contents {
		width: calc(100% - 64px);
	}
	.avatar {
		width: 48px;
		height: 48px;
	}
	div.avatar {
		margin-right: 12px;
	}
	img.avatar {
		border-radius: 10%;
		object-fit: cover;
	}
	.note {
		white-space: pre-line;
	}
	.content-warning {
		border-radius: 3px;
		background-color: rgba(255, 255, 127, 0.1);
	}
	div.toggle-content-warning {
		padding: 5px;
	}
	.hashtag {
		margin-left: 0.5em;
	}
	.menu {
		margin-top: 2px;
		margin-left: -60px;
		padding-left: 60px;
		position: relative;
	}
	.command {
		margin-top: 2px;
	}
	.command > span,
	.comment-form > span {
		margin-right: 20px;
	}
	.created_at {
		font-size: small;
	}
	.comment-form input.reason {
		min-width: 18em;
	}
	.comment-form textarea.comment {
		margin-top: 5px;
	}
	div.details {
		margin-left: -60px;
	}
	details.details {
		overflow-x: auto;
	}
	summary {
		width: 100%;
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
	.reason ~ span.add-cw > button.svg.add-cw > svg {
		fill: yellow;
	}
	div.tree.comment {
		padding: 5px;
		border-radius: 5px;
	}
	div.tree.comment.odd {
		background-color: rgba(255, 127, 127, 0.1);
	}
	div.tree.comment.even {
		background-color: rgba(127, 127, 255, 0.1);
	}
	div.tree.comment.referenced {
		outline: 2px solid yellow;
	}
</style>
