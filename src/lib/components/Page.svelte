<script lang="ts">
	import { page } from '$app/state';
	import {
		clientTag,
		defaultReactionToAdd,
		getRoboHashURL,
		linkGitHub,
		sitename
	} from '$lib/config';
	import type { RelayConnector, UrlParams } from '$lib/resource';
	import type { NostrEvent } from 'nostr-tools/pure';
	import * as nip19 from 'nostr-tools/nip19';
	import {
		getContentWarning,
		getTagValue,
		unixNow,
		type ProfileContent
	} from 'applesauce-core/helpers';
	import {
		getAllTagsMap,
		getEventsReactionToTheTarget,
		getTagsForContent,
		getTitleFromWebbookmarks,
		getWebBookmarkMap
	} from '$lib/utils';
	import Profile from '$lib/components/Profile.svelte';
	import Hashtag from '$lib/components/Hashtag.svelte';
	import CreateEntry from '$lib/components/CreateEntry.svelte';
	import AddStar from '$lib/components/AddStar.svelte';
	import Entry from '$lib/components/Entry.svelte';

	let {
		up,
		rc,
		loginPubkey,
		isEnabledUseDarkMode = $bindable(),
		isEnabledUseClientTag = $bindable(),
		saveLocalStorage,
		profileMap,
		eventsProfile,
		eventsWebBookmark,
		eventsReaction,
		eventsWebReaction,
		eventsComment,
		eventsEmojiSet,
		eventsQuoted,
		isMutedPubkeyPage,
		isMutedHashtagPage
	}: {
		up: UrlParams;
		rc: RelayConnector | undefined;
		loginPubkey: string | undefined;
		isEnabledUseDarkMode: boolean;
		isEnabledUseClientTag: boolean;
		saveLocalStorage: () => void;
		profileMap: Map<string, ProfileContent>;
		eventsProfile: NostrEvent[];
		eventsWebBookmark: NostrEvent[];
		eventsReaction: NostrEvent[];
		eventsWebReaction: NostrEvent[];
		eventsComment: NostrEvent[];
		eventsEmojiSet: NostrEvent[];
		eventsQuoted: NostrEvent[];
		isMutedPubkeyPage: boolean;
		isMutedHashtagPage: boolean;
	} = $props();

	const isSingleEntryPage: boolean = $derived(
		up.currentAddressPointer !== undefined || up.currentEventPointer !== undefined
	);
	const webBookmarkMap: Map<string, NostrEvent[]> = $derived(getWebBookmarkMap(eventsWebBookmark));

	let isOpenEdit: boolean = $state(false);
	let editDTag: string = $state('');
	let editTitleTag: string = $state('');
	let editTag: string = $state('');
	let editTags: string[] = $state([]);
	let editContent: string = $state('');
	let editContentTextArea: HTMLTextAreaElement | undefined = $state();
	let isContentWarningEnabled: boolean = $state(false);
	let contentWarningReason: string = $state('');

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
		if (event === undefined) {
			return undefined;
		}
		return getTagValue(event, 'published_at');
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
		if (isContentWarningEnabled) {
			const cwTag: string[] = ['content-warning'];
			if (contentWarningReason.length > 0) {
				cwTag.push(contentWarningReason);
			}
			tags.push(cwTag);
		}
		editDTag = '';
		editTitleTag = '';
		editTag = '';
		editTags = [];
		editContent = '';
		contentWarningReason = '';
		isContentWarningEnabled = false;
		isOpenEdit = false;
		for (const tag of getTagsForContent(
			content,
			eventsEmojiSet,
			rc.getSeenOn,
			rc.getEventsByFilter,
			rc.getReplaceableEvent
		)) {
			tags.push(tag);
		}
		if (isEnabledUseClientTag) {
			tags.push(clientTag);
		}
		await rc.signAndSendEvent({ kind, tags, content, created_at });
	};

	const sendComment = async (
		content: string,
		targetEventToReply: NostrEvent,
		contentWarning: string | boolean
	): Promise<void> => {
		if (rc === undefined) {
			return;
		}
		await rc.sendComment(
			content,
			targetEventToReply,
			eventsEmojiSet,
			contentWarning,
			isEnabledUseClientTag ? clientTag : undefined
		);
	};

	const sendReaction = async (
		target: NostrEvent | string,
		content?: string,
		emojiurl?: string
	): Promise<void> => {
		if (rc === undefined) {
			return;
		}
		await rc.sendReaction(
			target,
			content ?? defaultReactionToAdd,
			emojiurl,
			isEnabledUseClientTag ? clientTag : undefined
		);
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
		const identifier: string = getTagValue(webbookmark, 'd') ?? '';
		const title: string = getTagValue(webbookmark, 'title') ?? '';
		const cw: string | boolean = getContentWarning(webbookmark);
		const hashtags: string[] = Array.from(
			new Set<string>(
				webbookmark.tags
					.filter((tag) => tag.length >= 2 && tag[0] === 't')
					.map((tag) => tag[1].toLowerCase())
			)
		);
		if (cw !== false) {
			isContentWarningEnabled = true;
			if (cw !== true) {
				contentWarningReason = cw;
			}
		}
		editDTag = identifier;
		editTitleTag = title;
		editTag = '';
		editTags = hashtags;
		editContent = webbookmark.content;
		isOpenEdit = true;
		setTimeout(() => {
			editContentTextArea?.focus();
		}, 10);
	};
</script>

<header>
	<h1><a href="/">{sitename}</a></h1>
	{#if !up.isError}
		<details class="settings">
			<summary>
				<span class="show-settings">
					<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
						<path
							fill-rule="evenodd"
							d="M20.8733438,18.6798456 L18.6561681,20.8970213 L15.8183182,20.1064695 L15.006735,20.4411839 L13.5498403,22.99899 L10.4152664,22.99899 L8.96643872,20.4324639 L8.15567513,20.0925211 L5.31808752,20.8732969 L3.1019687,18.6571781 L3.89252047,15.8193282 L3.557737,15.0075774 L1,13.5496234 L1,10.4151434 L3.56757573,8.96634421 L3.90747891,8.15567513 L3.12670306,5.31808752 L5.34198234,3.10280823 L8.17984769,3.89446381 L8.99071892,3.56004309 L10.4454387,1 L13.5808166,1 L15.0296158,3.56757573 L15.8402849,3.90747891 L18.6774046,3.12683179 L20.8961418,5.34235339 L20.1054595,8.18067182 L20.4399569,8.99172892 L23,10.4464487 L23,13.5818266 L20.4326665,15.0304891 L20.0924686,15.8429951 L20.8733438,18.6798456 Z M17.9808573,15.7077573 L18.8526582,13.6256062 L21,12.4139314 L21,11.6103133 L18.8534478,10.3905557 L17.9941264,8.30695569 L18.6558226,5.93165934 L18.0869626,5.36362372 L15.7044076,6.01919516 L13.6244596,5.14709956 L12.4129214,3 L11.6093033,3 L10.3895457,5.1465522 L8.30575983,6.00595029 L5.93001038,5.34320732 L5.36375245,5.90946526 L6.01919516,8.29155242 L5.14709956,10.3715004 L3,11.5830386 L3,12.3875547 L5.14481829,13.610138 L6.00385363,15.6930443 L5.34202685,18.0688091 L5.90946526,18.6362476 L8.29155242,17.9808048 L10.3714059,18.8528608 L11.5829156,20.99899 L12.3873378,20.99899 L13.6089604,18.8542408 L15.6920343,17.9951364 L18.0677992,18.6569631 L18.6362007,18.0885616 L17.9808573,15.7077573 Z M12,16 C9.790861,16 8,14.209139 8,12 C8,9.790861 9.790861,8 12,8 C14.209139,8 16,9.790861 16,12 C16,14.209139 14.209139,16 12,16 Z M12,14 C13.1045695,14 14,13.1045695 14,12 C14,10.8954305 13.1045695,10 12,10 C10.8954305,10 10,10.8954305 10,12 C10,13.1045695 10.8954305,14 12,14 Z"
						/>
					</svg>
				</span>
			</summary>
			<ul>
				<li>
					<input
						id="dark-mode"
						type="checkbox"
						bind:checked={isEnabledUseDarkMode}
						onchange={saveLocalStorage}
					/>
					<label for="dark-mode">use dark mode</label>
				</li>
				{#if loginPubkey !== undefined}
					<li>
						<input
							id="client-tag"
							type="checkbox"
							bind:checked={isEnabledUseClientTag}
							onchange={saveLocalStorage}
						/>
						<label for="client-tag">add client tag</label>
					</li>
				{/if}
			</ul>
		</details>
		<span class="login-user">
			{#if loginPubkey === undefined}
				<img src="/apple-touch-icon.png" alt="KUCHIYOSE's favicon" class="login-user" />
			{:else}
				<a href="/{nip19.npubEncode(loginPubkey)}">
					<img
						src={profileMap.get(loginPubkey)?.picture ?? getRoboHashURL(loginPubkey)}
						alt="your avatar"
						class="login-user"
					/>
				</a>
			{/if}
		</span>
	{/if}
</header>
<main>
	{#if up.isError}
		<h2>{page.status} {page.error?.message ?? ''}</h2>
	{:else if up.currentProfilePointer !== undefined}
		{@const pubkey = up.currentProfilePointer.pubkey}
		{@const event = eventsProfile.find((ev) => ev.pubkey === pubkey)}
		<Profile
			{pubkey}
			{event}
			isLoggedIn={loginPubkey !== undefined}
			{isMutedPubkeyPage}
			mutePubkey={() => mutePubkey(pubkey)}
			unmutePubkey={() => unmutePubkey(pubkey)}
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
			{eventsQuoted}
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
	{#if up.currentEventPointer !== undefined && up.currentEventPointer.kind !== 1111}
		{@const event = rc?.getEventsByFilter({ ids: [up.currentEventPointer.id] }).at(0)}
		{#if event !== undefined}
			<Entry
				{event}
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
				{eventsQuoted}
				{isSingleEntryPage}
			/>
		{:else}
			{@const enc = nip19.neventEncode(up.currentEventPointer)}
			<a href={`/${enc}`}>{`nostr:${enc}`}</a>
		{/if}
	{:else if up.currentAddressPointer !== undefined && up.currentAddressPointer.kind !== 39701}
		{@const event = rc?.getReplaceableEvent(
			up.currentAddressPointer.kind,
			up.currentAddressPointer.pubkey,
			up.currentAddressPointer.identifier
		)}
		{#if event !== undefined}
			<Entry
				{event}
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
				{eventsQuoted}
				{isSingleEntryPage}
			/>
		{:else}
			{@const enc = nip19.naddrEncode(up.currentAddressPointer)}
			<a href={`/${enc}`}>{`nostr:${enc}`}</a>
		{/if}
	{:else if !up.isError}
		<CreateEntry
			bind:isOpenEdit
			bind:editDTag
			bind:editTitleTag
			bind:editTag
			bind:editTags
			bind:editContent
			bind:editContentTextArea
			bind:isContentWarningEnabled
			bind:contentWarningReason
			{loginPubkey}
			{eventsEmojiSet}
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
							{eventsQuoted}
							{isSingleEntryPage}
						/>
					{/each}
				</dd>
			{/each}
		</dl>
	{/if}
</main>
<footer><a href={linkGitHub} target="_blank" rel="noopener noreferrer">GitHub</a></footer>

<style>
	header {
		display: flex;
		justify-content: space-between;
		position: relative;
	}
	span.login-user {
		align-content: center;
	}
	img.login-user {
		width: 48px;
		height: 48px;
		border-radius: 10%;
	}
	details.settings {
		position: absolute;
		right: 60px;
		top: 5px;
	}
	details.settings > summary {
		width: 100%;
		height: 16px;
		line-height: 1em;
		text-align: right;
		list-style-type: none;
	}
	details.settings > summary > span > svg {
		width: 16px;
		height: 16px;
		fill: var(--text-bright);
	}
	details.settings ul {
		list-style: none;
		padding-left: 0;
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
		color: var(--highlight);
		text-shadow: 0 0 2px white;
	}
	.hashtag:not(:first-child) {
		margin-left: 0.5em;
	}
	footer {
		text-align: center;
	}
</style>
