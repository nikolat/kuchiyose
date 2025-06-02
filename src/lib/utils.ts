import { sortEvents, type NostrEvent } from 'nostr-tools/pure';
import type { Filter } from 'nostr-tools/filter';
import { isAddressableKind, isReplaceableKind } from 'nostr-tools/kinds';
import { normalizeURL } from 'nostr-tools/utils';
import * as nip19 from 'nostr-tools/nip19';
import type { LazyFilter } from 'rx-nostr';
import {
	getCoordinateFromAddressPointer,
	getOutboxes,
	getProfileContent,
	getTagValue
} from 'applesauce-core/helpers';
import data from '@emoji-mart/data';
// @ts-expect-error なんもわからんかも
import type { BaseEmoji } from '@types/emoji-mart';

interface MyBaseEmoji extends BaseEmoji {
	shortcodes: string;
	src: string | undefined;
}

export const kindsForParse: number[] = [1, 42, 1111, 30023, 39701];

export const getEventsAddressableLatest = (events: NostrEvent[]): NostrEvent[] => {
	const eventMap: Map<string, NostrEvent> = new Map<string, NostrEvent>();
	for (const ev of events) {
		if (!(isAddressableKind(ev.kind) || isReplaceableKind(ev.kind))) {
			continue;
		}
		const ap: nip19.AddressPointer = {
			...ev,
			identifier: isAddressableKind(ev.kind) ? (getTagValue(ev, 'd') ?? '') : ''
		};
		const s: string = getCoordinateFromAddressPointer(ap);
		const event: NostrEvent | undefined = eventMap.get(s);
		if (event === undefined || ev.created_at > event.created_at) {
			eventMap.set(s, ev);
		}
	}
	return sortEvents(Array.from(eventMap.values()));
};

export const isValidWebBookmark = (d: string, event?: NostrEvent): boolean => {
	if (!URL.canParse(`https://${d}`)) {
		if (event !== undefined) {
			console.warn(`d-tag: "${d}" is cannot parse as URL`, event);
		}
		return false;
	}
	const url = new URL(`https://${d}`);
	if (url.search !== '' || url.hash !== '' || d.endsWith('?') || d.endsWith('#')) {
		if (event !== undefined) {
			console.warn(`d-tag: "${d}" has query parameters`, event);
		}
		return false;
	}
	if (url.href.replace(/^https?:\/\//, '') !== d) {
		if (event !== undefined) {
			console.warn(`d-tag: "${d}" should be "${url.href.replaceAll(/https?:?\/\//g, '')}"`, event);
		}
		return false;
	}
	return true;
};

export const getWebBookmarkMap = (eventsWebBookmark: NostrEvent[]) => {
	const map = new Map<string, NostrEvent[]>();
	for (const ev of eventsWebBookmark) {
		const d = getTagValue(ev, 'd') ?? '';
		const url = `https://${d}`;
		const events = map.get(url);
		if (events === undefined) {
			map.set(url, [ev]);
		} else {
			map.set(url, sortEvents(events.concat(ev)));
		}
	}
	return new Map<string, NostrEvent[]>(
		Array.from(map.entries()).toSorted((a, b) => {
			const f = (e: [string, NostrEvent[]]) => Math.max(...e[1].map((ev) => ev.created_at));
			return f(b) - f(a);
		})
	);
};

export const getTitleFromWebbookmarks = (eventsWebBookmark: NostrEvent[]): string | undefined => {
	const map = new Map<string, NostrEvent[]>();
	for (const ev of eventsWebBookmark) {
		const title = getTagValue(ev, 'title');
		if (title === undefined || title.length === 0) {
			continue;
		}
		const events = map.get(title);
		if (events === undefined) {
			map.set(title, [ev]);
		} else {
			map.set(title, events.concat(ev));
		}
	}
	const [title, _events] = Array.from(map.entries())
		.toSorted((a, b) => {
			const f1 = (e: [string, NostrEvent[]]) => e[1].length;
			const f2 = (e: [string, NostrEvent[]]) => Math.max(...e[1].map((ev) => ev.created_at));
			return f1(b) === f1(a) ? f2(b) - f2(a) : f1(b) - f1(a);
		})
		.at(0) ?? [undefined, []];
	return title;
};

export const getAllTagsMap = (eventsWebBookmark: NostrEvent[]): Map<string, number> => {
	const map = new Map<string, number>();
	for (const ev of eventsWebBookmark) {
		const tTags = ev.tags
			.filter((tag) => tag.length >= 2 && tag[0] === 't')
			.map((tag) => tag[1].toLowerCase());
		for (const t of tTags) {
			const n = map.get(t);
			if (n === undefined) {
				map.set(t, 1);
			} else {
				map.set(t, n + 1);
			}
		}
	}
	const a = Array.from(map.entries()).toSorted((a, b) => {
		return b[1] - a[1];
	});
	return new Map<string, number>(a);
};

export const getEventsReactionToTheTarget = (
	target: NostrEvent | string,
	eventsReaction: NostrEvent[]
): NostrEvent[] => {
	if (typeof target !== 'string') {
		return getEventsReactionToTheEvent(target, eventsReaction);
	} else {
		return getEventsReactionToTheUrl(target, eventsReaction);
	}
};

const getEventsReactionToTheEvent = (
	event: NostrEvent,
	eventsReaction: NostrEvent[]
): NostrEvent[] => {
	return eventsReaction.filter((ev) => {
		const a = getTagValue(ev, 'a');
		if (a !== undefined && (isAddressableKind(event.kind) || isReplaceableKind(event.kind))) {
			const ap: nip19.AddressPointer = {
				...event,
				identifier: isAddressableKind(event.kind) ? (getTagValue(event, 'd') ?? '') : ''
			};
			return a === getCoordinateFromAddressPointer(ap);
		} else {
			return (
				ev.tags
					.filter((tag) => tag.length >= 2 && tag[0] === 'e')
					.at(-1)
					?.at(1) === event.id
			);
		}
	});
};

const getEventsReactionToTheUrl = (url: string, eventsReaction: NostrEvent[]): NostrEvent[] => {
	return eventsReaction.filter((ev) => getTagValue(ev, 'r') === url);
};

export const splitNip51List = async (
	event: NostrEvent,
	loginPubkey: string
): Promise<{
	pPub: string[];
	ePub: string[];
	wPub: string[];
	tPub: string[];
	pSec: string[];
	eSec: string[];
	wSec: string[];
	tSec: string[];
	tagList: string[][];
	contentList: string[][];
}> => {
	const getList = (tags: string[][], tagName: string): string[] =>
		Array.from(
			new Set<string>(
				tags.filter((tag) => tag.length >= 2 && tag[0] === tagName).map((tag) => tag[1])
			)
		);
	const [pPub, ePub, wPub, tPub] = ['p', 'e', 'word', 't'].map((tagName: string) =>
		getList(event.tags, tagName)
	);
	let [pSec, eSec, wSec, tSec]: [string[], string[], string[], string[]] = [[], [], [], []];
	const tagList: string[][] = event.tags;
	let contentList: string[][] = [];
	if (event.content.length > 0 && window.nostr?.nip04 !== undefined) {
		try {
			const content = await window.nostr.nip04.decrypt(loginPubkey, event.content);
			contentList = JSON.parse(content);
		} catch (error) {
			console.warn(error);
		}
		[pSec, eSec, wSec, tSec] = ['p', 'e', 'word', 't'].map((tagName: string) =>
			getList(contentList, tagName)
		);
	}
	return { pPub, ePub, wPub, tPub, pSec, eSec, wSec, tSec, tagList, contentList };
};

export const getMuteList = async (
	eventMuteList: NostrEvent | undefined,
	loginPubkey: string | undefined
): Promise<[string[], string[], string[], string[]]> => {
	let [mutedPubkeys, mutedIds, mutedWords, mutedHashTags]: [
		string[],
		string[],
		string[],
		string[]
	] = [[], [], [], []];
	if (
		eventMuteList === undefined ||
		loginPubkey === undefined ||
		eventMuteList.pubkey !== loginPubkey
	) {
		return [mutedPubkeys, mutedIds, mutedWords, mutedHashTags];
	}
	const { pPub, ePub, wPub, tPub, pSec, eSec, wSec, tSec } = await splitNip51List(
		eventMuteList,
		loginPubkey
	);
	mutedPubkeys = Array.from(new Set<string>([...pPub, ...pSec]));
	mutedIds = Array.from(new Set<string>([...ePub, ...eSec]));
	mutedWords = Array.from(new Set<string>([...wPub, ...wSec].map((w) => w.toLowerCase())));
	mutedHashTags = Array.from(new Set<string>([...tPub, ...tSec].map((t) => t.toLowerCase())));
	return [mutedPubkeys, mutedIds, mutedWords, mutedHashTags];
};

export const getEventsFilteredByMute = (
	events: NostrEvent[],
	mutedPubkeys: string[],
	mutedIds: string[],
	mutedWords: string[],
	mutedHashTags: string[]
) => {
	const filteredEvents: NostrEvent[] = [];
	for (const event of events) {
		if (mutedPubkeys.includes(event.pubkey)) {
			continue;
		}
		if (mutedIds.includes(event.id)) {
			continue;
		}
		if (mutedWords.some((word) => event.content.includes(word))) {
			continue;
		}
		if (
			mutedHashTags.some((hashTag) =>
				event.tags
					.filter((tag) => tag.length >= 2 && tag[0] === 't')
					.map((tag) => tag[1].toLowerCase())
					.includes(hashTag)
			)
		) {
			continue;
		}
		filteredEvents.push(event);
	}
	return filteredEvents;
};

export const getPubkeysForFilter = (
	events: NostrEvent[]
): { pubkeys: string[]; relays: string[] } => {
	const pubkeySet: Set<string> = new Set();
	const relaySet: Set<string> = new Set<string>();
	for (const ev of events) {
		let content: string | undefined = undefined;
		if (ev.kind === 0) {
			content = getProfileContent(ev).about;
		} else if (kindsForParse.includes(ev.kind)) {
			content = ev.content;
		}
		if (content !== undefined) {
			const matchesIterator = content.matchAll(
				/nostr:(npub1\w{58}|nprofile1\w+|nevent1\w+|naddr1\w+)/g
			);
			for (const match of matchesIterator) {
				let d;
				try {
					d = nip19.decode(match[1]);
				} catch (_error) {
					continue;
				}
				if (d.type === 'npub') {
					pubkeySet.add(d.data);
				} else if (d.type === 'nprofile') {
					pubkeySet.add(d.data.pubkey);
					if (d.data.relays !== undefined) {
						for (const relay of d.data.relays) {
							relaySet.add(normalizeURL(relay));
						}
					}
				} else if (d.type === 'nevent' && d.data.author !== undefined) {
					pubkeySet.add(d.data.author);
					if (d.data.relays !== undefined) {
						for (const relay of d.data.relays) {
							relaySet.add(normalizeURL(relay));
						}
					}
				} else if (d.type === 'naddr') {
					pubkeySet.add(d.data.pubkey);
					if (d.data.relays !== undefined) {
						for (const relay of d.data.relays) {
							relaySet.add(normalizeURL(relay));
						}
					}
				}
			}
		}
	}
	return { pubkeys: Array.from(pubkeySet), relays: Array.from(relaySet) };
};

export const getIdsForFilter = (
	events: NostrEvent[]
): { ids: string[]; aps: nip19.AddressPointer[]; relays: string[] } => {
	const idSet: Set<string> = new Set<string>();
	const aps: nip19.AddressPointer[] = [];
	const apsSet: Set<string> = new Set<string>();
	const relaySet: Set<string> = new Set<string>();
	for (const ev of events) {
		let content: string | undefined = undefined;
		if (ev.kind === 0) {
			content = getProfileContent(ev).about;
		} else if (kindsForParse.includes(ev.kind)) {
			content = ev.content;
		}
		if (content !== undefined) {
			const matchesIterator = content.matchAll(/nostr:(note1\w{58}|nevent1\w+|naddr1\w+)/g);
			for (const match of matchesIterator) {
				let d;
				try {
					d = nip19.decode(match[1]);
				} catch (_error) {
					continue;
				}
				if (d.type === 'note') {
					idSet.add(d.data);
				} else if (d.type === 'nevent') {
					idSet.add(d.data.id);
					if (d.data.relays !== undefined) {
						for (const relay of d.data.relays) {
							relaySet.add(normalizeURL(relay));
						}
					}
				} else if (d.type === 'naddr') {
					const str = getCoordinateFromAddressPointer(d.data);
					if (!apsSet.has(str)) {
						aps.push(d.data);
						apsSet.add(str);
					}
					if (d.data.relays !== undefined) {
						for (const relay of d.data.relays) {
							relaySet.add(normalizeURL(relay));
						}
					}
				}
			}
		}
	}
	return { ids: Array.from(idSet), aps: aps, relays: Array.from(relaySet) };
};

export const getTagsForContent = (
	content: string,
	eventsEmojiSet: NostrEvent[],
	getSeenOn: (id: string, excludeWs: boolean) => string[],
	getEventsByFilter: (filters: Filter | Filter[]) => NostrEvent[],
	getReplaceableEvent: (kind: number, pubkey: string, d?: string) => NostrEvent | undefined
): string[][] => {
	const tags: string[][] = [];
	const ppMap: Map<string, nip19.ProfilePointer> = new Map<string, nip19.ProfilePointer>();
	const epMap: Map<string, nip19.EventPointer> = new Map<string, nip19.EventPointer>();
	const apMap: Map<string, nip19.AddressPointer> = new Map<string, nip19.AddressPointer>();
	const matchesIteratorId = content.matchAll(
		/(^|\W|\b)(nostr:(note1\w{58}|nevent1\w+|naddr1\w+))($|\W|\b)/g
	);
	for (const match of matchesIteratorId) {
		let d;
		try {
			d = nip19.decode(match[3]);
		} catch (_error) {
			continue;
		}
		if (d.type === 'note') {
			epMap.set(d.data, { id: d.data });
		} else if (d.type === 'nevent') {
			if (!epMap.has(d.data.id) || d.data.relays !== undefined) {
				epMap.set(d.data.id, d.data);
			}
			if (d.data.author !== undefined) {
				ppMap.set(d.data.author, { pubkey: d.data.author });
			}
		} else if (d.type === 'naddr') {
			const c = getCoordinateFromAddressPointer(d.data);
			if (!apMap.has(c) || d.data.relays !== undefined) {
				apMap.set(c, d.data);
			}
			ppMap.set(d.data.pubkey, { pubkey: d.data.pubkey });
		}
	}
	const matchesIteratorPubkey = content.matchAll(
		/(^|\W|\b)(nostr:(npub1\w{58}|nprofile1\w+))($|\W|\b)/g
	);
	for (const match of matchesIteratorPubkey) {
		let d;
		try {
			d = nip19.decode(match[3]);
		} catch (_error) {
			continue;
		}
		if (d.type === 'npub') {
			if (!ppMap.has(d.data)) {
				ppMap.set(d.data, { pubkey: d.data });
			}
		} else if (d.type === 'nprofile') {
			if (!ppMap.has(d.data.pubkey) || d.data.relays !== undefined) {
				ppMap.set(d.data.pubkey, d.data);
			}
		}
	}
	const matchesIteratorLink = content.matchAll(/https?:\/\/[\w!?/=+\-_~:;.,*&@#$%()[\]]+/g);
	const links: Set<string> = new Set<string>();
	for (const match of matchesIteratorLink) {
		links.add(urlLinkString(match[0])[0]);
	}
	const emojiMapToAdd: Map<string, string> = new Map<string, string>();
	const emojiMap: Map<string, string> = getEmojiMap(eventsEmojiSet);
	const matchesIteratorEmojiTag = content.matchAll(
		new RegExp(`:(${Array.from(emojiMap.keys()).join('|')}):`, 'g')
	);
	for (const match of matchesIteratorEmojiTag) {
		const url = emojiMap.get(match[1]);
		if (url !== undefined) {
			emojiMapToAdd.set(match[1], url);
		}
	}
	for (const [id, ep] of epMap) {
		const qTag: string[] = ['q', id];
		const ev: NostrEvent | undefined = getEventsByFilter({ ids: [id] }).at(0);
		const recommendedRelayForQuote: string | undefined =
			getSeenOn(id, true).at(0) ?? ep.relays?.filter((relay) => relay.startsWith('wss://')).at(0);
		const pubkey: string | undefined = ev?.pubkey ?? ep.author;
		if (recommendedRelayForQuote !== undefined) {
			qTag.push(recommendedRelayForQuote);
			if (pubkey !== undefined) {
				qTag.push(pubkey);
			}
		}
		tags.push(qTag);
		if (pubkey !== undefined && !ppMap.has(pubkey)) {
			ppMap.set(pubkey, { pubkey });
		}
	}
	for (const [a, ap] of apMap) {
		const qTag: string[] = ['q', a];
		const ev: NostrEvent | undefined = getReplaceableEvent(ap.kind, ap.pubkey, ap.identifier);
		const recommendedRelayForQuote: string | undefined =
			getSeenOn(ev?.id ?? '', true).at(0) ??
			ap.relays?.filter((relay) => relay.startsWith('wss://')).at(0);
		if (recommendedRelayForQuote !== undefined) {
			qTag.push(recommendedRelayForQuote);
		}
		tags.push(qTag);
		if (!ppMap.has(ap.pubkey)) {
			ppMap.set(ap.pubkey, { pubkey: ap.pubkey });
		}
	}
	for (const [p, pp] of ppMap) {
		const pTag: string[] = ['p', p];
		const kind0: NostrEvent | undefined = getReplaceableEvent(0, p);
		const recommendedRelayForPubkey: string | undefined =
			getSeenOn(kind0?.id ?? '', true).at(0) ??
			pp.relays?.filter((relay) => relay.startsWith('wss://')).at(0);
		if (recommendedRelayForPubkey !== undefined) {
			pTag.push(recommendedRelayForPubkey);
		}
		tags.push(pTag);
	}
	for (const r of links) {
		tags.push(['r', r]);
	}
	for (const [shortcode, url] of emojiMapToAdd) {
		tags.push(['emoji', shortcode, url]);
	}
	return tags;
};

export const mergeFilterForAddressableEvents = (filters: LazyFilter[]): Filter[] => {
	const kinds: Set<number> = new Set<number>(filters.map((f) => f.kinds ?? []).flat());
	const newFilters: Filter[] = [];
	for (const kind of kinds) {
		const filterMap: Map<string, Set<string>> = new Map<string, Set<string>>();
		for (const filter of filters.filter((f) => f.kinds?.includes(kind))) {
			const author: string = filter.authors?.at(0) ?? '';
			const dTags: string[] = filter['#d'] ?? [];
			if (filterMap.has(author)) {
				for (const dTag of dTags) {
					filterMap.set(author, filterMap.get(author)!.add(dTag));
				}
			} else {
				filterMap.set(author, new Set<string>(dTags));
			}
		}
		for (const [author, dTagSet] of filterMap) {
			const filter: Filter = { kinds: [kind], authors: [author] };
			if (isAddressableKind(kind)) {
				filter['#d'] = Array.from(dTagSet);
			}
			newFilters.push(filter);
		}
	}
	return newFilters;
};

const inputCount = (input: string): number => {
	// simple check, not perfect
	const segmeter = new Intl.Segmenter('ja-JP', { granularity: 'word' });
	return Array.from(segmeter.segment(input)).length;
};

export const isCustomEmoji = (event: NostrEvent): boolean => {
	const emojiTags = event.tags.filter((tag) => tag[0] === 'emoji');
	if (emojiTags.length !== 1) return false;
	const emojiTag = emojiTags[0];
	return (
		emojiTag.length >= 3 &&
		/^\w+$/.test(emojiTag[1]) &&
		URL.canParse(emojiTag[2]) &&
		event.content === `:${emojiTag[1]}:`
	);
};

export const isValidEmoji = (event: NostrEvent): boolean => {
	return isCustomEmoji(event) || inputCount(event.content) <= 1;
};

export const getEmojiMap = (eventsEmojiSet: NostrEvent[]): Map<string, string> => {
	const r = new Map<string, string>();
	for (const ev of eventsEmojiSet) {
		const emojiTags: string[][] = ev.tags.filter(
			(tag) => tag.length >= 3 && tag[0] === 'emoji' && /^\w+$/.test(tag[1]) && URL.canParse(tag[2])
		);
		for (const emojiTag of emojiTags) {
			const shortcode = emojiTag[1];
			const url = emojiTag[2];
			const urlStored = r.get(shortcode);
			if (urlStored === undefined) {
				r.set(shortcode, url);
			} else if (urlStored !== url) {
				let i = 2;
				while (true) {
					const shortcodeAnother = `${shortcode}_${i}`;
					const urlStored2 = r.get(shortcodeAnother);
					if (urlStored2 === undefined) {
						r.set(shortcodeAnother, url);
						break;
					}
					if (urlStored2 === url) {
						break;
					}
					i++;
				}
			}
		}
	}
	return r;
};

export const getEmoji = async (
	emojiPickerContainer: HTMLElement,
	emojiMap: Map<string, string>,
	autoClose: boolean,
	callbackEmojiSelect: (emojiStr: string, emojiUrl: string | undefined) => Promise<void>
): Promise<void> => {
	const { Picker } = await import('emoji-mart');
	return new Promise((resolve) => {
		if (emojiPickerContainer.children.length > 0) {
			resolve();
			return;
		}
		const close = () => {
			emojiPickerContainer.firstChild?.remove();
			resolve();
		};
		const onEmojiSelect = (emoji: MyBaseEmoji) => {
			const emojiStr = emoji.native ?? emoji.shortcodes;
			const emojiUrl = emoji.src;
			callbackEmojiSelect(emojiStr, emojiUrl);
			if (autoClose) {
				close();
			}
		};
		const onClickOutside = () => {
			close();
		};
		const picker = new Picker({
			data,
			custom: [
				{
					id: 'custom-emoji',
					name: 'Custom Emojis',
					emojis: Array.from(emojiMap.entries()).map(([shortcode, url]) => {
						return {
							id: shortcode,
							name: shortcode,
							keywords: [shortcode],
							skins: [{ shortcodes: `:${shortcode}:`, src: url }]
						};
					})
				}
			],
			autoFocus: true,
			onEmojiSelect,
			onClickOutside
		});
		//スマホで1回目に生成したインスタンスがonClickOutsideを呼び続けるので回避するためタイマーを仕掛ける
		setTimeout(() => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			emojiPickerContainer.appendChild(picker as any);
		}, 10);
	});
};

const indexOfFirstUnmatchingCloseParen = (url: string, left: string, right: string): number => {
	let nest = 0;
	for (let i = 0; i < url.length; i++) {
		const c = url.charAt(i);
		if (c === left) {
			nest++;
		} else if (c === right) {
			if (nest <= 0) {
				return i;
			}
			nest--;
		}
	}
	return -1;
};

//https://github.com/jiftechnify/motherfucking-nostr-client
export const urlLinkString = (url: string): [string, string] => {
	for (const [left, right] of [
		['(', ')'],
		['[', ']']
	]) {
		const splitIdx: number = indexOfFirstUnmatchingCloseParen(url, left, right);
		if (splitIdx >= 0) {
			return [url.substring(0, splitIdx), url.substring(splitIdx)];
		}
	}
	return [url, ''];
};

const dtformat = new Intl.DateTimeFormat('ja-jp', {
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
	hour: '2-digit',
	minute: '2-digit',
	second: '2-digit'
});

export const getDateTimeString = (created_at: number): string => {
	return dtformat.format(new Date(created_at * 1000)).replaceAll('/', '-');
};

export const getReadRelaysWithOutboxModel = (
	pubkeys: string[],
	getReplaceable: (kind: number, pubkey: string, d?: string) => NostrEvent | undefined,
	relaysToRead: string[],
	deadRelays: string[]
): string[] => {
	const relayUserMap: Map<string, Set<string>> = new Map<string, Set<string>>();
	for (const pubkey of pubkeys) {
		const event: NostrEvent | undefined = getReplaceable(10002, pubkey);
		if (event === undefined) {
			continue;
		}
		const relays = getOutboxes(event).filter(
			(relay) => relay.startsWith('wss://') && !deadRelays.includes(relay)
		);
		for (const relayUrl of relays) {
			const users: Set<string> = relayUserMap.get(relayUrl) ?? new Set<string>();
			users.add(pubkey);
			relayUserMap.set(relayUrl, users);
		}
	}
	const requiredRelays: string[] = getRequiredRelays(relayUserMap, relaysToRead);
	const relaySet = new Set<string>();
	for (const relayUrl of [...relaysToRead, ...requiredRelays]) {
		relaySet.add(relayUrl);
	}
	return Array.from(relaySet);
};

const getRequiredRelays = (
	relayUserMap: Map<string, Set<string>>,
	relaysUsed: string[]
): string[] => {
	const relayUserMapArray: [string, string[]][] = [];
	for (const [relayUrl, users] of relayUserMap) {
		relayUserMapArray.push([relayUrl, Array.from(users)]);
	}
	const compareFn = (a: [string, string[]], b: [string, string[]]) => {
		return b[1].length - a[1].length;
	};
	relayUserMapArray.sort(compareFn);
	const relaysAll: string[] = relayUserMapArray.map((a) => a[0]);
	const relaySet: Set<string> = new Set<string>();
	const allPubkeySet: Set<string> = new Set<string>(relayUserMapArray.map((e) => e[1]).flat());
	const relayUserMapCloned: Map<string, Set<string>> = new Map<string, Set<string>>();
	for (const up of relayUserMapArray) {
		relayUserMapCloned.set(up[0], new Set<string>(up[1]));
	}
	for (const relay of relaysUsed) {
		const users: Set<string> = relayUserMapCloned.get(relay) ?? new Set<string>();
		for (const p of users) {
			allPubkeySet.delete(p);
		}
	}
	for (const relay of relaysAll.filter((r) => !relaysUsed.includes(r))) {
		if (allPubkeySet.size === 0) {
			break;
		}
		const users: Set<string> = relayUserMapCloned.get(relay) ?? new Set<string>();
		if (Array.from(users).some((p) => allPubkeySet.has(p))) {
			relaySet.add(relay);
			relayUserMapCloned.set(
				relay,
				new Set<string>(Array.from(users).filter((p) => allPubkeySet.has(p)))
			);
			for (const p of users) {
				allPubkeySet.delete(p);
			}
		}
	}
	return Array.from(relaySet);
};
