<script lang="ts">
	import { getRoboHashURL, limitDepth } from '$lib/config';
	import { urlLinkString } from '$lib/utils';
	import type { NostrEvent } from 'nostr-tools/pure';
	import * as nip19 from 'nostr-tools/nip19';
	import { getTagValue, type ProfileContent } from 'applesauce-core/helpers';
	import Entry from '$lib/components/Entry.svelte';

	const {
		content,
		tags,
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
		isSingleEntryPage
	}: {
		content: string;
		tags: string[][];
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
	} = $props();

	type Token =
		| {
				type: 'text';
				value: string;
		  }
		| {
				type: 'link';
				href: string;
				value: string;
		  }
		| {
				type: 'mention';
				decoded: nip19.DecodedResult;
				encoded: string;
				value: string;
		  }
		| {
				type: 'emoji';
				code: string;
				url: string;
		  };

	const getExpandTagsList = (content: string, tags: string[][]) => {
		const regMatchArray = [
			'https?://[\\w!?/=+\\-_~:;.,*&@#$%()[\\]]+',
			'nostr:npub1\\w{58}',
			'nostr:nprofile1\\w+',
			'nostr:note1\\w{58}',
			'nostr:nevent1\\w+',
			'nostr:naddr1\\w+'
		];
		const emojiUrlMap: Map<string, string> = new Map<string, string>();
		for (const tag of tags) {
			if (tag.length >= 3 && tag[0] === 'emoji' && /\w+/.test(tag[1]) && URL.canParse(tag[2])) {
				emojiUrlMap.set(`:${tag[1]}:`, tag[2]);
			}
		}
		if (emojiUrlMap.size > 0) {
			regMatchArray.push(Array.from(emojiUrlMap.keys()).join('|'));
		}
		const regMatch = new RegExp(regMatchArray.map((v) => `(${v})`).join('|'), 'g');
		const regSplit = new RegExp(regMatchArray.join('|'));

		const plainTexts = content.split(regSplit);
		const matchesIterator = content.matchAll(regMatch);
		const children: [Token] = [
			{
				type: 'text',
				value: plainTexts[0]
			}
		];
		let i = 1;
		for (const m of matchesIterator) {
			const mLink = m.at(1);
			const mMention = m.at(2) ?? m.at(3) ?? m.at(4) ?? m.at(5) ?? m.at(6);
			const shortcode = m.at(7);
			const mMentionDecoded: nip19.DecodedResult | null =
				mMention === undefined ? null : nip19decode(mMention.replace(/nostr:/, ''));
			if (mLink !== undefined && /^https?:\/\/\S+/.test(mLink) && URL.canParse(mLink)) {
				children.push({
					type: 'link',
					href: new URL(mLink).toString(),
					value: mLink
				});
			} else if (mMention !== undefined && mMentionDecoded !== null) {
				children.push({
					type: 'mention',
					decoded: mMentionDecoded,
					encoded: mMention.replace(/nostr:/, ''),
					value: mMention
				});
			} else if (shortcode !== undefined) {
				children.push({
					type: 'emoji',
					code: shortcode,
					url: emojiUrlMap.get(shortcode)!
				});
			} else {
				children.push({
					type: 'text',
					value: mLink ?? mMention ?? ''
				});
			}
			children.push({
				type: 'text',
				value: plainTexts[i]
			});
			i++;
		}
		return {
			type: 'root',
			event: undefined,
			children
		};
	};

	const nip19decode = (text: string): nip19.DecodedResult | null => {
		try {
			return nip19.decode(text);
		} catch (_error) {
			return null;
		}
	};

	const ats = $derived(getExpandTagsList(content, tags));
</script>

{#each ats.children as ct, i (i)}
	{#if ct.type === 'link'}
		{@const [url, rest] = urlLinkString(ct.value)}
		<a href={url} target="_blank" rel="noopener noreferrer">{url}</a>{rest}
	{:else if ct.type === 'mention'}
		{@const d = ct.decoded}
		{#if ['npub', 'nprofile'].includes(d.type)}
			{@const hex = d.type === 'npub' ? d.data : d.type === 'nprofile' ? d.data.pubkey : ''}
			{@const enc = ct.encoded}
			{@const prof = profileMap.get(hex)}
			{@const name = prof?.name ?? enc}
			<a href="/{enc}"
				><img
					src={prof?.picture ?? getRoboHashURL(hex)}
					alt={name.slice(0, 20)}
					title={name.slice(0, 20)}
					class="avatar"
				/>{name.slice(0, 20)}</a
			>
		{:else if ['note', 'nevent', 'naddr'].includes(d.type)}
			{@const event =
				d.type === 'naddr'
					? eventsQuoted.find(
							(ev) =>
								ev.kind === d.data.kind &&
								ev.pubkey === d.data.pubkey &&
								(getTagValue(ev, 'd') ?? '') === d.data.identifier
						)
					: eventsQuoted.find(
							(ev) => ev.id === (d.type === 'note' ? d.data : d.type === 'nevent' ? d.data.id : '')
						)}
			{#if event !== undefined && level < limitDepth}
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
					{eventsQuoted}
					{isSingleEntryPage}
					isQuote={true}
				/>
			{:else}
				{@const enc = ct.encoded}
				<a href={`/${enc}`}>{`nostr:${enc}`}</a>
			{/if}
		{/if}
	{:else if ct.type === 'emoji'}
		<img src={ct.url} alt={ct.code} title={ct.code} class="emoji" />
	{:else if ct.type === 'text'}
		{ct.value}
	{/if}
{/each}

<style>
	.avatar {
		width: 16px;
		height: 16px;
		border-radius: 10%;
	}
	.emoji {
		height: 1.5em;
		vertical-align: top;
	}
</style>
