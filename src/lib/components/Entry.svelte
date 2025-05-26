<script lang="ts">
	import { getRoboHashURL } from '$lib/config';
	import { getEventsReactionToTheTarget } from '$lib/utils';
	import type { NostrEvent } from 'nostr-tools/pure';
	import { isRegularKind } from 'nostr-tools/kinds';
	import * as nip19 from 'nostr-tools/nip19';
	import { getTagValue, type ProfileContent } from 'applesauce-core/helpers';
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
		eventsQuoted
	}: {
		event: NostrEvent;
		eventsComment: NostrEvent[];
		level: number;
		idReferenced: string | undefined;
		getSeenOn: (id: string, excludeWs: boolean) => string[];
		fork: (event: NostrEvent) => void;
		sendComment: (content: string, targetEventToReply: NostrEvent) => Promise<void>;
		sendReaction: (event: NostrEvent, content?: string, emojiurl?: string) => Promise<void>;
		sendDeletion: (event: NostrEvent) => Promise<void>;
		loginPubkey: string | undefined;
		profileMap: Map<string, ProfileContent>;
		eventsReaction: NostrEvent[];
		eventsEmojiSet: NostrEvent[];
		eventsQuoted: NostrEvent[];
	} = $props();

	let isDetailsVisible: boolean = $state(false);
	let isCommentFormVisible: boolean = $state(false);
	let editComment: string = $state('');

	const identifier = $derived(getTagValue(event, 'd') ?? '');
	const hashtags = $derived(
		new Set<string>(
			event.tags
				.filter((tag) => tag.length >= 2 && tag[0] === 't')
				.map((tag) => tag[1].toLowerCase())
		)
	);
	const prof = $derived(profileMap.get(event.pubkey));
	const naddr = $derived(
		nip19.naddrEncode({
			identifier,
			pubkey: event.pubkey,
			kind: event.kind,
			relays: getSeenOn(event.id, true)
		})
	);
	const nevent = $derived(
		nip19.neventEncode({
			id: event.id,
			relays: getSeenOn(event.id, true),
			author: event.pubkey,
			kind: event.kind
		})
	);
	const linkStr = $derived(isRegularKind(event.kind) ? nevent : naddr);
	const commentsToTheEvent = $derived(
		isRegularKind(event.kind)
			? eventsComment.filter((ev) => getTagValue(ev, 'e') === event.id)
			: eventsComment.filter(
					(ev) =>
						getTagValue(ev, 'a') ===
						`${event.kind}:${event.pubkey}:${getTagValue(event, 'd') ?? ''}`
				)
	);
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
		return classNames;
	});
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
				<a class="name" href="/{nip19.npubEncode(event.pubkey)}"
					>@{prof?.name ?? `${nip19.npubEncode(event.pubkey).slice(0, 15)}...`}</a
				><span class="hashtags">
					{#each hashtags as hashtag (hashtag)}
						<a href="/t/{encodeURI(hashtag)}" class="hashtag">#{hashtag}</a>
					{/each}
				</span>
				<br />
				<span class="content">
					<Content
						content={event.content}
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
					/>
				</span>
			</div>
			<div class="menu">
				<a href="/{linkStr}">
					<time datetime={new Date(1000 * event.created_at).toISOString()} class="created_at"
						>{new Date(1000 * event.created_at).toLocaleString()}</time
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
					{#if fork !== undefined}
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
					{#if loginPubkey === event.pubkey}
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
				<textarea class="comment" disabled={loginPubkey === undefined} bind:value={editComment}
				></textarea>
				<button
					type="button"
					disabled={loginPubkey === undefined || editComment.length === 0}
					onclick={async () => {
						await sendComment(editComment, event);
						editComment = '';
					}}>Submit</button
				>
			{/if}
			{#if isDetailsVisible}
				<div class="details">
					<details class="details" bind:open={isDetailsVisible}>
						<summary>Details</summary>
						<dl class="details">
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
	.hashtag {
		margin-left: 0.5em;
	}
	.menu {
		margin-top: 2px;
		position: relative;
	}
	.command {
		margin-top: 2px;
	}
	.command > span {
		margin-right: 20px;
	}
	.created_at {
		font-size: small;
	}
	textarea.comment {
		margin-top: 5px;
	}
	div.details {
		margin-left: -100px;
	}
	div.tree.comment div.details {
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
	div.tree.comment {
		margin-left: 20px;
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
