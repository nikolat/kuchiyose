<script lang="ts">
	import { getRoboHashURL } from '$lib/config';
	import { urlLinkString } from '$lib/utils';
	import type { NostrEvent } from 'nostr-tools/pure';
	import type { Filter } from 'nostr-tools/filter';
	import * as nip19 from 'nostr-tools/nip19';
	import type { ProfileContent } from 'applesauce-core/helpers';
	import Entry from '$lib/components/Entry.svelte';

	const {
		content,
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
		getEventsByFilter,
		getReplaceableEvent
	}: {
		content: string;
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
		getEventsByFilter: (filters: Filter | Filter[]) => NostrEvent[];
		getReplaceableEvent: (kind: number, pubkey: string, d?: string) => NostrEvent | undefined;
	} = $props();

	const getExpandTagsList = (content: string): [IterableIterator<RegExpMatchArray>, string[]] => {
		const regMatchArray = [
			'https?://[\\w!?/=+\\-_~:;.,*&@#$%()[\\]]+',
			'nostr:npub1\\w{58}',
			'nostr:nprofile1\\w+',
			'nostr:note1\\w{58}',
			'nostr:nevent1\\w+',
			'nostr:naddr1\\w+'
		];
		const regMatch = new RegExp(regMatchArray.map((v) => `(${v})`).join('|'), 'g');
		const regSplit = new RegExp(regMatchArray.join('|'));
		return [content.matchAll(regMatch), content.split(regSplit)];
	};

	const [matchesIterator, plainTexts] = $derived(getExpandTagsList(content));

	const nip19decode = (text: string) => {
		try {
			return nip19.decode(text);
		} catch (_error) {
			return null;
		}
	};
</script>

{plainTexts[0]}{#each Array.from(matchesIterator) as match, i (i)}
	{@const urlHttp = match[1]}
	{@const nostr_npub1 = match[2]}
	{@const nostr_nprofile1 = match[3]}
	{@const nostr_note1 = match[4]}
	{@const nostr_nevent1 = match[5]}
	{@const nostr_naddr1 = match[6]}
	{#if /^https?:\/\/\S+/.test(urlHttp) && URL.canParse(urlHttp)}
		{@const [url, rest] = urlLinkString(urlHttp)}
		<a href={url} target="_blank" rel="noopener noreferrer">{url}</a>{rest}
	{:else if /nostr:npub1\w{58}/.test(nostr_npub1)}
		{@const matchedText = nostr_npub1}
		{@const npubText = matchedText.replace(/nostr:/, '')}
		{@const d = nip19decode(npubText)}
		{#if d?.type === 'npub'}
			{@const prof = profileMap.get(d.data)}
			{@const name = prof?.name ?? nip19.npubEncode(d.data)}
			<a href="/{npubText}"
				><img
					src={prof?.picture ?? getRoboHashURL(d.data)}
					alt={name.slice(0, 20)}
					title={name.slice(0, 20)}
					class="avatar"
				/>{name.slice(0, 20)}</a
			>
		{:else}{matchedText}
		{/if}
	{:else if /nostr:nprofile1\w+/.test(nostr_nprofile1)}
		{@const matchedText = nostr_nprofile1}
		{@const nprofileText = matchedText.replace(/nostr:/, '')}
		{@const d = nip19decode(nprofileText)}
		{#if d?.type === 'nprofile'}
			{@const prof = profileMap.get(d.data.pubkey)}
			{@const name = prof?.name ?? nip19.npubEncode(d.data.pubkey)}
			<a href="/{nprofileText}"
				><img
					src={prof?.picture ?? getRoboHashURL(d.data.pubkey)}
					alt={name.slice(0, 20)}
					title={name.slice(0, 20)}
					class="avatar"
				/>{name.slice(0, 20)}</a
			>
		{:else}{matchedText}
		{/if}
	{:else if /nostr:note1\w{58}/.test(nostr_note1)}
		{@const matchedText = nostr_note1}
		{@const note = matchedText.replace(/nostr:/, '')}
		{@const d = nip19decode(note)}
		{#if d?.type === 'note'}
			{@const event = getEventsByFilter({ ids: [d.data] }).at(0)}
			{#if event !== undefined}
				<Entry
					{event}
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
					{getEventsByFilter}
					{getReplaceableEvent}
				/>
			{:else}
				<a href={`/${note}`}>{matchedText}</a>
			{/if}
		{:else}{matchedText}
		{/if}
	{:else if /nostr:nevent1\w+/.test(nostr_nevent1)}
		{@const matchedText = nostr_nevent1}
		{@const nevent = matchedText.replace(/nostr:/, '')}
		{@const d = nip19decode(nevent)}
		{#if d?.type === 'nevent'}
			{@const event = getEventsByFilter({ ids: [d.data.id] }).at(0)}
			{#if event !== undefined}
				<Entry
					{event}
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
					{getEventsByFilter}
					{getReplaceableEvent}
				/>
			{:else}
				<a href={`/${nevent}`}>{matchedText}</a>
			{/if}
		{:else}{matchedText}
		{/if}
	{:else if /nostr:naddr1\w+/.test(nostr_naddr1)}
		{@const matchedText = nostr_naddr1}
		{@const naddr = matchedText.replace(/nostr:/, '')}
		{@const d = nip19decode(naddr)}
		{#if d?.type === 'naddr'}
			{@const event = getReplaceableEvent(d.data.kind, d.data.pubkey, d.data.identifier)}
			{#if event !== undefined}
				<Entry
					{event}
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
					{getEventsByFilter}
					{getReplaceableEvent}
				/>
			{:else}
				<a href={`/${naddr}`}>{matchedText}</a>
			{/if}
		{:else}{matchedText}
		{/if}
	{/if}{plainTexts[i + 1]}
{/each}

<style>
	.avatar {
		width: 16px;
		height: 16px;
		border-radius: 10%;
	}
</style>
