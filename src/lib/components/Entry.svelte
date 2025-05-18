<script lang="ts">
	import { getRoboHashURL } from '$lib/config';
	import * as nip19 from 'nostr-tools/nip19';
	import type { NostrEvent } from 'nostr-tools/pure';
	import type { ProfileContent } from 'applesauce-core/helpers';
	import Content from '$lib/components/Content.svelte';
	import AddStar from '$lib/components/AddStar.svelte';

	const {
		webbookmark,
		seenOn,
		fork,
		sendReaction,
		sendDeletion,
		loginPubkey,
		profileMap,
		eventsReaction,
		eventsEmojiSet,
		isDevMode
	}: {
		webbookmark: NostrEvent;
		seenOn: string[];
		fork: (event: NostrEvent) => void;
		sendReaction: (content?: string, emojiurl?: string) => Promise<void>;
		sendDeletion: (event: NostrEvent) => Promise<void>;
		loginPubkey: string | undefined;
		profileMap: Map<string, ProfileContent>;
		eventsReaction: NostrEvent[];
		eventsEmojiSet: NostrEvent[];
		isDevMode: boolean;
	} = $props();

	const identifier = $derived(
		webbookmark.tags.find((tag) => tag.length >= 2 && tag[0] === 'd')?.at(1) ?? ''
	);
	const hashtags = $derived(
		new Set<string>(
			webbookmark.tags
				.filter((tag) => tag.length >= 2 && tag[0] === 't')
				.map((tag) => tag[1].toLowerCase())
		)
	);
	const prof = $derived(profileMap.get(webbookmark.pubkey));
	const naddr = $derived(
		nip19.naddrEncode({
			kind: webbookmark.kind,
			pubkey: webbookmark.pubkey,
			identifier,
			relays: seenOn.filter((relay) => relay.startsWith('wss://'))
		})
	);
</script>

<div class="entry">
	<div class="avatar">
		<a href="/{nip19.npubEncode(webbookmark.pubkey)}">
			<img src={prof?.picture ?? getRoboHashURL(webbookmark.pubkey)} alt="" class="avatar" />
		</a>
	</div>
	<div class="contents">
		<div class="comment">
			<a class="name" href="/{nip19.npubEncode(webbookmark.pubkey)}"
				>@{prof?.name ?? `${nip19.npubEncode(webbookmark.pubkey).slice(0, 15)}...`}</a
			><span class="hashtags">
				{#each hashtags as hashtag (hashtag)}
					<a href="/t/{encodeURI(hashtag)}" class="hashtag">#{hashtag}</a>
				{/each}
			</span>
			<br />
			<span class="content"><Content content={webbookmark.content} /></span>
		</div>
		<div class="menu">
			{#if loginPubkey !== undefined}
				<button
					type="button"
					class="fork"
					onclick={() => {
						fork(webbookmark);
					}}>Fork</button
				>
			{/if}
			<a href="/{naddr}">
				<time class="created_at">{new Date(1000 * webbookmark.created_at).toLocaleString()}</time>
			</a>
			{#if loginPubkey === webbookmark.pubkey}
				<span class="bookmark-delete">
					<button
						type="button"
						class="svg bookmark-delete"
						title="delete the bookmark"
						aria-label="delete the bookmark"
						onclick={async () => {
							await sendDeletion(webbookmark);
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
			<AddStar
				{sendReaction}
				{sendDeletion}
				{loginPubkey}
				{profileMap}
				{eventsReaction}
				{eventsEmojiSet}
			/>
		</div>
		{#if isDevMode}
			<details class="details">
				<summary>view JSON</summary>
				<dl class="details">
					<dt>Event JSON</dt>
					<dd>
						<pre class="json-view"><code>{JSON.stringify(webbookmark, undefined, 2)}</code></pre>
					</dd>
					<dt>Relays seen on</dt>
					<dd>
						<ul>
							{#each seenOn as relay (relay)}
								<li>{relay}</li>
							{/each}
						</ul>
					</dd>
				</dl>
			</details>
		{/if}
	</div>
</div>

<style>
	.entry {
		display: flex;
		margin-top: 1em;
		margin-bottom: 1em;
	}
	.contents {
		width: calc(100% - 64px);
	}
	.avatar {
		width: 48px;
		height: 48px;
	}
	div.avatar {
		margin-right: 0.5em;
	}
	img.avatar {
		border-radius: 10%;
	}
	.comment {
		white-space: pre-line;
	}
	.hashtag {
		margin-left: 0.5em;
	}
	.menu {
		margin-top: 2px;
		position: relative;
	}
	.fork {
		padding: 0 3px;
	}
	.created_at {
		font-size: small;
	}
	.details {
		overflow-x: auto;
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
</style>
