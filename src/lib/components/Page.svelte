<script lang="ts">
	import { getRoboHashURL, linkGitHub, sitename } from '$lib/config';
	import type { RelayConnector, UrlParams } from '$lib/resource';
	import * as nip19 from 'nostr-tools/nip19';
	import type { NostrEvent } from 'nostr-tools/pure';
	import { unixNow, type ProfileContent } from 'applesauce-core/helpers';
	import {
		getAllTagsMap,
		getEventsReactionToTheTarget,
		getTitleFromWebbookmarks,
		getWebBookmarkMap
	} from '$lib/utils';
	import Profile from '$lib/components/Profile.svelte';
	import Hashtag from '$lib/components/Hashtag.svelte';
	import CreateEntry from '$lib/components/CreateEntry.svelte';
	import AddStar from '$lib/components/AddStar.svelte';
	import Entry from '$lib/components/Entry.svelte';

	const {
		up,
		rc,
		loginPubkey,
		profileMap,
		eventsWebBookmark,
		eventsReaction,
		eventsWebReaction,
		eventsComment,
		eventsEmojiSet,
		isMutedPubkeyPage,
		isMutedHashtagPage
	}: {
		up: UrlParams;
		rc: RelayConnector | undefined;
		loginPubkey: string | undefined;
		profileMap: Map<string, ProfileContent>;
		eventsWebBookmark: NostrEvent[];
		eventsReaction: NostrEvent[];
		eventsWebReaction: NostrEvent[];
		eventsComment: NostrEvent[];
		eventsEmojiSet: NostrEvent[];
		isMutedPubkeyPage: boolean;
		isMutedHashtagPage: boolean;
	} = $props();

	const webBookmarkMap: Map<string, NostrEvent[]> = $derived(getWebBookmarkMap(eventsWebBookmark));

	let isOpenEdit: boolean = $state(false);
	let editDTag: string = $state('');
	let editTitleTag: string = $state('');
	let editTag: string = $state('');
	let editTags: string[] = $state([]);
	let editTagInput: HTMLInputElement | undefined = $state();
	let editContent: string = $state('');

	const mutePubkey = async (pubkey: string): Promise<void> => {
		if (rc === undefined || loginPubkey === undefined) {
			return;
		}
		await rc.mutePubkey(pubkey, loginPubkey, rc.getReplaceableEvent(10000, loginPubkey));
	};

	const unmutePubkey = async (pubkey: string): Promise<void> => {
		if (rc === undefined || loginPubkey === undefined) {
			return;
		}
		await rc.unmutePubkey(pubkey, loginPubkey, rc.getReplaceableEvent(10000, loginPubkey));
	};

	const muteHashtag = async (hashtag: string): Promise<void> => {
		if (rc === undefined || loginPubkey === undefined) {
			return;
		}
		await rc.muteHashtag(hashtag, loginPubkey, rc.getReplaceableEvent(10000, loginPubkey));
	};

	const unmuteHashtag = async (hashtag: string): Promise<void> => {
		if (rc === undefined || loginPubkey === undefined) {
			return;
		}
		await rc.unmuteHashtag(hashtag, loginPubkey, rc.getReplaceableEvent(10000, loginPubkey));
	};

	const getPublishedAt = (d: string): string | undefined => {
		if (rc === undefined || loginPubkey === undefined) {
			return undefined;
		}
		const event = rc.getReplaceableEvent(39701, loginPubkey, d);
		return event?.tags.find((tag) => tag.length >= 2 && tag[0] === 'published_at')?.at(1);
	};

	const sendWebBookmark = async (): Promise<void> => {
		if (rc === undefined) {
			return;
		}
		const kind: number = 39701;
		const content: string = editContent;
		const created_at: number = unixNow();
		const tags: string[][] = [
			['d', editDTag],
			['published_at', getPublishedAt(editDTag) ?? String(created_at)],
			...editTags.map((t) => ['t', t])
		];
		if (editTitleTag.length > 0) {
			tags.push(['title', editTitleTag]);
		}
		editDTag = '';
		editTitleTag = '';
		editTag = '';
		editTags = [];
		editContent = '';
		await rc.signAndSendEvent({ kind, tags, content, created_at });
	};

	const sendComment = async (content: string, targetEventToReply: NostrEvent): Promise<void> => {
		if (rc === undefined) {
			return;
		}
		await rc.sendComment(content, targetEventToReply);
	};

	const sendReaction = async (
		target: NostrEvent | string,
		content?: string,
		emojiurl?: string
	): Promise<void> => {
		if (rc === undefined) {
			return;
		}
		await rc.sendReaction(target, content, emojiurl);
	};

	const sendReactionToUrl = (url: string) => (content?: string, emojiurl?: string) =>
		sendReaction(url, content, emojiurl);

	const sendDeletion = async (targetEvent: NostrEvent): Promise<void> => {
		if (rc === undefined) {
			return;
		}
		await rc.sendDeletion(targetEvent);
	};

	const idReferenced: string | undefined = $derived(up.currentEventPointer?.id);

	const getSeenOn = (id: string, excludeWs: boolean) => rc?.getSeenOn(id, excludeWs) ?? [];

	const fork = (webbookmark: NostrEvent): void => {
		const identifier =
			webbookmark.tags.find((tag) => tag.length >= 2 && tag[0] === 'd')?.at(1) ?? '';
		const title =
			webbookmark.tags.find((tag) => tag.length >= 2 && tag[0] === 'title')?.at(1) ?? '';
		const hashtags = Array.from(
			new Set<string>(
				webbookmark.tags
					.filter((tag) => tag.length >= 2 && tag[0] === 't')
					.map((tag) => tag[1].toLowerCase())
			)
		);
		editDTag = identifier;
		editTitleTag = title;
		editTag = '';
		editTags = hashtags;
		editContent = webbookmark.content;
		isOpenEdit = true;
		setTimeout(() => {
			editTagInput?.focus();
		}, 10);
	};
</script>

<header>
	<h1><a href="/">{sitename}</a></h1>
	<span class="setting">
		{#if loginPubkey !== undefined}
			<a href="/{nip19.npubEncode(loginPubkey)}">
				<img
					src={profileMap.get(loginPubkey)?.picture ?? getRoboHashURL(loginPubkey)}
					alt="your avatar"
					class="login-user"
				/>
			</a>
		{/if}
	</span>
</header>
<main>
	{#if up.currentProfilePointer !== undefined}
		{@const pubkey = up.currentProfilePointer.pubkey}
		<Profile
			{pubkey}
			profile={profileMap.get(pubkey)}
			isLoggedIn={loginPubkey !== undefined}
			{isMutedPubkeyPage}
			mutePubkey={() => mutePubkey(pubkey)}
			unmutePubkey={() => unmutePubkey(pubkey)}
		/>
	{:else if up.hashtag !== undefined}
		{@const hashtag = up.hashtag}
		<Hashtag
			{hashtag}
			isLoggedIn={loginPubkey !== undefined}
			{isMutedHashtagPage}
			muteHashtag={() => muteHashtag(hashtag)}
			unmuteHashtag={() => unmuteHashtag(hashtag)}
		/>
	{/if}
	<CreateEntry
		bind:isOpenEdit
		bind:editDTag
		bind:editTitleTag
		bind:editTag
		bind:editTags
		bind:editTagInput
		bind:editContent
		{loginPubkey}
		{sendWebBookmark}
	/>
	<section class="tag-cloud">
		{#each getAllTagsMap(eventsWebBookmark) as [t, n] (t)}
			<a href="/t/{encodeURI(t)}" class="hashtag">#{t}</a>:{n}
		{/each}
	</section>
	<dl class="url">
		{#each webBookmarkMap as [url, webbookmarks] (url)}
			{@const path = url.replace(/^https?:\/\//, '')}
			{@const title = getTitleFromWebbookmarks(webbookmarks)}
			{@const n = webbookmarks.length}
			<dt>
				<img
					src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(url)}`}
					alt="favicon"
					class="favicon"
				/>
				<a href={url} target="_blank" rel="noopener noreferrer">{title ?? url}</a>
				<br />
				<span class="url">{url}</span>
				<br />
				<a href="/entry/{path}" class="bookmark-count">{n > 1 ? `${n}users` : `${n}user`}</a>
				<AddStar
					sendReaction={sendReactionToUrl(url)}
					{sendDeletion}
					{loginPubkey}
					{profileMap}
					eventsReaction={getEventsReactionToTheTarget(url, eventsWebReaction)}
					{eventsEmojiSet}
				/>
			</dt>
			<dd>
				{#each webbookmarks as webbookmark (webbookmark.pubkey)}
					<Entry
						event={webbookmark}
						{eventsComment}
						level={0}
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
					/>
				{/each}
			</dd>
		{/each}
	</dl>
</main>
<footer><a href={linkGitHub} target="_blank" rel="noopener noreferrer">GitHub</a></footer>

<style>
	header {
		display: flex;
		justify-content: space-between;
	}
	.setting {
		align-content: center;
	}
	.login-user {
		width: 48px;
		height: 48px;
		border-radius: 10%;
	}
	.url > dt {
		border-radius: 5px;
		padding: 5px;
		background-color: rgba(0, 0, 0, 0.2);
		position: relative;
		margin-top: 1em;
	}
	.favicon {
		width: 16px;
		height: 16px;
		border-radius: 10%;
	}
	span.url {
		font-size: small;
		color: var(--text-muted);
	}
	.bookmark-count {
		display: inline-block;
		color: pink;
		text-shadow: 0 0 2px white;
	}
	.hashtag:not(:first-child) {
		margin-left: 0.5em;
	}
	footer {
		text-align: center;
	}
</style>
