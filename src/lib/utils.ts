import type { NostrEvent } from 'nostr-tools/pure';
import type { RelayRecord } from 'nostr-tools/relay';
import { normalizeURL } from 'nostr-tools/utils';
import * as nip19 from 'nostr-tools/nip19';
import data from '@emoji-mart/data';
// @ts-expect-error なんもわからんかも
import type { BaseEmoji } from '@types/emoji-mart';

interface MyBaseEmoji extends BaseEmoji {
	shortcodes: string;
	src: string | undefined;
}

export const getAddressPointerFromAId = (aId: string): nip19.AddressPointer | null => {
	const sp = aId.split(':');
	if (sp.length < 3) {
		return null;
	}
	try {
		const ap: nip19.AddressPointer = { identifier: sp[2], pubkey: sp[1], kind: parseInt(sp[0]) };
		return ap;
	} catch (error) {
		console.warn(error);
		return null;
	}
};

export const getEventsAddressableLatest = (events: NostrEvent[]): NostrEvent[] => {
	const eventMap: Map<string, NostrEvent> = new Map<string, NostrEvent>();
	for (const ev of events) {
		const s = `${ev.kind}:${ev.pubkey}:${ev.tags.find((tag) => tag.length >= 2 && tag[0] === 'd')?.at(1) ?? ''}`;
		const event = eventMap.get(s);
		if (event === undefined || ev.created_at > event.created_at) {
			eventMap.set(s, ev);
		}
	}
	return Array.from(eventMap.values());
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
		const d = ev.tags.find((tag) => tag.length >= 2 && tag[0] === 'd')?.at(1) ?? '';
		if (!isValidWebBookmark(d, ev)) {
			continue;
		}
		const url = `https://${d}`;
		const events = map.get(url);
		if (events === undefined) {
			map.set(url, [ev]);
		} else {
			map.set(url, events.concat(ev));
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
		const title = ev.tags.find((tag) => tag.length >= 2 && tag[0] === 'title')?.at(1);
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

export const getEventsReactionToTheTarget = (
	target: NostrEvent | string,
	eventsReaction: NostrEvent[],
	mutedPubkeys: string[] = []
): NostrEvent[] => {
	if (typeof target !== 'string') {
		return getEventsReactionToTheEvent(target, eventsReaction, mutedPubkeys);
	} else {
		return getEventsReactionToTheUrl(target, eventsReaction, mutedPubkeys);
	}
};

const getEventsReactionToTheEvent = (
	event: NostrEvent,
	eventsReaction: NostrEvent[],
	mutedPubkeys: string[] = []
): NostrEvent[] => {
	return eventsReaction.filter((ev) => {
		const a = ev.tags.findLast((tag) => tag.length >= 2 && tag[0] === 'a')?.at(1);
		if (a !== undefined) {
			const d = event.tags.find((tag) => tag.length >= 2 && tag[0] === 'd')?.at(1) ?? '';
			return a === `${event.kind}:${event.pubkey}:${d}`;
		} else {
			return (
				ev.tags
					.filter((tag) => tag.length >= 2 && tag[0] === 'e')
					.at(-1)
					?.at(1) === event.id && !mutedPubkeys.includes(ev.pubkey)
			);
		}
	});
};

const getEventsReactionToTheUrl = (
	url: string,
	eventsReaction: NostrEvent[],
	mutedPubkeys: string[] = []
): NostrEvent[] => {
	return eventsReaction.filter(
		(ev) =>
			ev.tags.findLast((tag) => tag.length >= 2 && tag[0] === 'r')?.at(1) === url &&
			!mutedPubkeys.includes(ev.pubkey)
	);
};

export const getRelaysToUseFromKind10002Event = (event?: NostrEvent): RelayRecord => {
	const newRelays: RelayRecord = {};
	for (const tag of event?.tags.filter(
		(tag) => tag.length >= 2 && tag[0] === 'r' && URL.canParse(tag[1])
	) ?? []) {
		const url: string = normalizeURL(tag[1]);
		const isRead: boolean = tag.length === 2 || tag[2] === 'read';
		const isWrite: boolean = tag.length === 2 || tag[2] === 'write';
		if (newRelays[url] === undefined) {
			newRelays[url] = {
				read: isRead,
				write: isWrite
			};
		} else {
			if (isRead) {
				newRelays[url].read = true;
			}
			if (isWrite) {
				newRelays[url].write = true;
			}
		}
	}
	return newRelays;
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
	onCallbackEmojiSelect: ({
		emojiStr,
		emojiUrl
	}: {
		emojiStr: string;
		emojiUrl: string | undefined;
	}) => void
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
			onCallbackEmojiSelect({ emojiStr, emojiUrl });
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
