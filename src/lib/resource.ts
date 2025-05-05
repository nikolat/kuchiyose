import { bufferTime, type OperatorFunction } from 'rxjs';
import {
	batch,
	createRxBackwardReq,
	createRxForwardReq,
	createRxNostr,
	createTie,
	latestEach,
	now,
	type EventPacket,
	type LazyFilter,
	type MergeFilter,
	type RxNostr,
	type RxNostrSendOptions,
	type RxReq,
	type RxReqEmittable,
	type RxReqOverable,
	type RxReqPipeable
} from 'rx-nostr';
import { verifier } from '@rx-nostr/crypto';
import { EventStore } from 'applesauce-core';
import type { ProfileContent } from 'applesauce-core/helpers';
import { sortEvents, type EventTemplate, type NostrEvent } from 'nostr-tools/pure';
import type { RelayRecord } from 'nostr-tools/relay';
import { normalizeURL } from 'nostr-tools/utils';
import { nip19 } from 'nostr-tools';
import { defaultRelays, profileRelays } from '$lib/config';

export type UrlParams = {
	currentProfilePointer?: nip19.ProfilePointer;
	currentAddressPointer?: nip19.AddressPointer;
	hashtag?: string;
};

type ReqB = RxReq<'backward'> &
	RxReqEmittable<{
		relays: string[];
	}> &
	RxReqOverable &
	RxReqPipeable;

type ReqF = RxReq<'forward'> & RxReqEmittable & RxReqPipeable;

export class RelayConnector {
	#rxNostr: RxNostr;
	#eventStore: EventStore;
	#relayRecord: RelayRecord | undefined;
	#rxReqB0: ReqB;
	#rxReqB10002: ReqB;
	#rxReqB39701: ReqB;
	#rxReqF: ReqF;

	#tie: OperatorFunction<
		EventPacket,
		EventPacket & {
			seenOn: Set<string>;
			isNew: boolean;
		}
	>;
	#seenOn: Map<string, Set<string>>;
	#secBufferTime = 1000;

	#eventsDeletion: NostrEvent[];

	constructor(useAuth: boolean) {
		if (useAuth) {
			this.#rxNostr = createRxNostr({ verifier, authenticator: 'auto' });
		} else {
			this.#rxNostr = createRxNostr({ verifier });
		}
		this.#eventStore = new EventStore();
		this.#rxReqB0 = createRxBackwardReq();
		this.#rxReqB10002 = createRxBackwardReq();
		this.#rxReqB39701 = createRxBackwardReq();
		this.#rxReqF = createRxForwardReq();
		[this.#tie, this.#seenOn] = createTie();
		this.#rxNostr.setDefaultRelays(defaultRelays);
		this.#defineSubscription();
		this.#eventsDeletion = [];
	}

	dispose = () => {
		this.#rxNostr.dispose();
		for (const ev of this.#eventStore.getAll({ since: 0 })) {
			this.#eventStore.database.removeEvent(ev);
		}
	};

	#defineSubscription = () => {
		const batchedReq0 = this.#rxReqB0.pipe(
			bufferTime(this.#secBufferTime),
			batch(this.#mergeFilter0)
		);
		this.#rxNostr
			.use(batchedReq0, { relays: [...defaultRelays, ...profileRelays] })
			.pipe(
				this.#tie,
				latestEach(({ event }) => `${event.kind}:${event.pubkey}`)
			)
			.subscribe({
				next: this.#next,
				complete: this.#complete
			});
		this.#rxNostr
			.use(this.#rxReqB10002, { relays: [...defaultRelays, ...profileRelays] })
			.pipe(
				this.#tie,
				latestEach(({ event }) => `${event.kind}:${event.pubkey}`)
			)
			.subscribe({
				next: this.#next,
				complete: this.#complete
			});
		this.#rxNostr
			.use(this.#rxReqB39701)
			.pipe(
				this.#tie,
				latestEach(
					({ event }) =>
						`${event.pubkey}:${event.tags.find((tag) => tag.length >= 2 && tag[0] === 'd')?.at(1) ?? ''}`
				)
			)
			.subscribe({
				next: this.#next,
				complete: this.#complete
			});
		this.#rxNostr.use(this.#rxReqF).pipe(this.#tie).subscribe({
			next: this.#next,
			complete: this.#complete
		});
	};

	#mergeFilter0: MergeFilter = (a: LazyFilter[], b: LazyFilter[]) => {
		const margedFilters = [...a, ...b];
		const authors = Array.from(new Set<string>(margedFilters.map((f) => f.authors ?? []).flat()));
		const f = margedFilters.at(0);
		return [
			{ kinds: f?.kinds, authors: authors, limit: f?.limit, until: f?.until, since: f?.since }
		];
	};

	#next = (packet: EventPacket): void => {
		const event = packet.event;
		if (this.#eventStore.hasEvent(event.id)) {
			console.info('kind', event.kind, 'duplicated');
			return;
		}
		if (this.#getDeletedEventIdSet(this.#eventsDeletion).has(event.id)) {
			console.info('kind', event.kind, 'deleted');
			return;
		}
		this.#eventStore.add(event);
		console.info('kind', event.kind);
		if (event.kind === 5) {
			const ids: string[] = event.tags
				.filter((tag) => tag.length >= 2 && tag[0] === 'e')
				.map((tag) => tag[1]);
			for (const id of ids) {
				if (this.#eventStore.hasEvent(id)) {
					this.#eventStore.database.removeEvent(id);
				}
			}
		}
	};

	#complete = () => {};

	#getDeletedEventIdSet = (eventsDeletion: NostrEvent[]): Set<string> => {
		const deletedEventIdSet = new Set<string>();
		for (const ev of eventsDeletion) {
			const ids: string[] = ev.tags
				.filter((tag) => tag.length >= 2 && tag[0] === 'e')
				.map((tag) => tag[1]);
			for (const id of ids) {
				deletedEventIdSet.add(id);
			}
		}
		return deletedEventIdSet;
	};

	isValidWebBookmark = (d: string, event?: NostrEvent): boolean => {
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
				console.warn(
					`d-tag: "${d}" should be "${url.href.replaceAll(/https?:?\/\//g, '')}"`,
					event
				);
			}
			return false;
		}
		return true;
	};

	subscribeEventStore = (
		webBookmarkMap: { url: string; webbookmarks: NostrEvent[] }[],
		profileMap: { pubkey: string; profile: ProfileContent }[],
		callbackRelayRecord: () => void
	) => {
		return this.#eventStore.filters({ since: 0 }).subscribe((event: NostrEvent) => {
			switch (event.kind) {
				case 0: {
					let profObj: ProfileContent;
					try {
						profObj = JSON.parse(event.content);
					} catch (error) {
						console.warn({ error, event });
						return;
					}
					const prof = profileMap.find((v) => v.pubkey === event.pubkey)?.profile;
					if (prof !== undefined) {
						profileMap = profileMap.filter((v) => v.pubkey !== event.pubkey);
					}
					profileMap.push({ pubkey: event.pubkey, profile: profObj });
					break;
				}
				case 10002: {
					this.#relayRecord = this.#getRelaysToUseFromKind10002Event(event);
					this.#rxNostr.setDefaultRelays(this.#relayRecord);
					callbackRelayRecord();
					break;
				}
				case 39701: {
					const d = event.tags.find((tag) => tag.length >= 2 && tag[0] === 'd')?.at(1) ?? '';
					if (!this.isValidWebBookmark(d, event)) {
						return;
					}
					const url = new URL(`https://${d}`);
					const w = webBookmarkMap.find((v) => v.url === url.href);
					if (w !== undefined) {
						w.webbookmarks.push(event);
					} else {
						webBookmarkMap.push({ url: url.href, webbookmarks: [event] });
					}
					webBookmarkMap.sort((a, b) => {
						return (
							(sortEvents(b.webbookmarks).at(0)?.created_at ?? 0) -
							(sortEvents(a.webbookmarks).at(0)?.created_at ?? 0)
						);
					});
					if (profileMap.find((v) => v.pubkey === event.pubkey) === undefined) {
						this.#fetchProfile(event.pubkey);
					}
					break;
				}
				default:
					break;
			}
		});
	};

	#getRelaysToUseFromKind10002Event = (event: NostrEvent): RelayRecord => {
		const newRelays: RelayRecord = {};
		for (const tag of event.tags.filter(
			(tag) => tag.length >= 2 && tag[0] === 'r' && URL.canParse(tag[1])
		)) {
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

	#fetchProfile = (pubkey: string) => {
		const filter: LazyFilter = {
			kinds: [0],
			authors: [pubkey],
			until: now()
		};
		this.#rxReqB0.emit(filter);
	};

	fetchUserInfo = (pubkey: string) => {
		this.#rxReqB0.emit({
			kinds: [0],
			authors: [pubkey],
			until: now()
		});
		this.#rxReqB10002.emit({
			kinds: [10002],
			authors: [pubkey],
			until: now()
		});
	};

	fetchWebBookmark = (params: UrlParams) => {
		const { currentAddressPointer, currentProfilePointer, hashtag } = params;
		const filter: LazyFilter = {
			kinds: [39701],
			until: now(),
			limit: 100
		};
		const relaySet: Set<string> = new Set<string>();
		if (currentAddressPointer !== undefined) {
			filter.kinds = [currentAddressPointer.kind];
			filter.authors = [currentAddressPointer.pubkey];
			filter['#d'] = [currentAddressPointer.identifier];
			for (const relay of currentAddressPointer.relays ?? []) {
				relaySet.add(normalizeURL(relay));
			}
		} else if (currentProfilePointer !== undefined) {
			filter.authors = [currentProfilePointer.pubkey];
			for (const relay of currentProfilePointer.relays ?? []) {
				relaySet.add(normalizeURL(relay));
			}
		}
		if (hashtag !== undefined) {
			filter['#t'] = [hashtag];
		}
		if (this.#relayRecord !== undefined) {
			for (const [relay, _] of Object.entries(this.#relayRecord).filter(([_, obj]) => obj.read)) {
				relaySet.add(relay);
			}
		} else {
			for (const relay of defaultRelays) {
				relaySet.add(relay);
			}
		}
		const options: { relays: string[] } = { relays: Array.from(relaySet) };
		this.#rxReqB39701.emit(filter, options);
		this.#rxReqF.emit(filter);
	};

	getSeenOn = (id: string, excludeWs: boolean): string[] => {
		const s = this.#seenOn.get(id);
		if (s === undefined) {
			return [];
		}
		if (excludeWs) {
			return Array.from(s)
				.filter((relay) => relay.startsWith('wss://'))
				.map((url) => normalizeURL(url));
		}
		return Array.from(s).map((url) => normalizeURL(url));
	};

	sendWebBookmark = async (content: string, tags: string[][]): Promise<void> => {
		if (window.nostr === undefined || this.#relayRecord === undefined) {
			return;
		}
		const eventTemplate: EventTemplate = {
			content,
			kind: 39701,
			tags,
			created_at: now()
		};
		const eventToSend = await window.nostr.signEvent(eventTemplate);
		const relaySet: Set<string> = new Set<string>();
		for (const [relay, _] of Object.entries(this.#relayRecord).filter(([_, obj]) => obj.write)) {
			relaySet.add(relay);
		}
		const options: Partial<RxNostrSendOptions> = { on: { relays: Array.from(relaySet) } };
		this.#sendEvent(eventToSend, options);
	};

	#sendEvent = (eventToSend: NostrEvent, options?: Partial<RxNostrSendOptions>): void => {
		this.#rxNostr.send(eventToSend, options);
	};
}
