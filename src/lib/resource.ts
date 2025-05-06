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
import { sortEvents, type EventTemplate, type NostrEvent } from 'nostr-tools/pure';
import { isAddressableKind, isReplaceableKind } from 'nostr-tools/kinds';
import type { RelayRecord } from 'nostr-tools/relay';
import type { Filter } from 'nostr-tools/filter';
import { normalizeURL } from 'nostr-tools/utils';
import { nip19 } from 'nostr-tools';
import {
	defaultReactionToAdd,
	defaultRelays,
	isEnabledOutboxModel,
	profileRelays
} from '$lib/config';
import {
	getAddressPointerFromAId,
	getRelaysToUseFromKind10002Event,
	isValidEmoji
} from '$lib/utils';

export type UrlParams = {
	currentProfilePointer?: nip19.ProfilePointer;
	currentAddressPointer?: nip19.AddressPointer;
	hashtag?: string;
	path?: string;
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
	#rxReqB7: ReqB;
	#rxReqB17: ReqB;
	#rxReqB10002: ReqB;
	#rxReqBRp: ReqB;
	#rxReqBAd: ReqB;
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
	#limitReaction = 100;

	#eventsDeletion: NostrEvent[];

	constructor(useAuth: boolean) {
		if (useAuth) {
			this.#rxNostr = createRxNostr({ verifier, authenticator: 'auto' });
		} else {
			this.#rxNostr = createRxNostr({ verifier });
		}
		this.#eventStore = new EventStore();
		this.#rxReqB0 = createRxBackwardReq();
		this.#rxReqB7 = createRxBackwardReq();
		this.#rxReqB17 = createRxBackwardReq();
		this.#rxReqB10002 = createRxBackwardReq();
		this.#rxReqBRp = createRxBackwardReq();
		this.#rxReqBAd = createRxBackwardReq();
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
		const batchedReq7 = this.#rxReqB7.pipe(
			bufferTime(this.#secBufferTime),
			batch(this.#mergeFilter7)
		);
		const batchedReq17 = this.#rxReqB17.pipe(
			bufferTime(this.#secBufferTime),
			batch(this.#mergeFilter17)
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
		this.#rxNostr.use(batchedReq7).pipe(this.#tie).subscribe({
			next: this.#next,
			complete: this.#complete
		});
		this.#rxNostr.use(batchedReq17).pipe(this.#tie).subscribe({
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
			.use(this.#rxReqBRp)
			.pipe(
				this.#tie,
				latestEach(({ event }) => `${event.kind}:${event.pubkey}`)
			)
			.subscribe({
				next: this.#next,
				complete: this.#complete
			});
		this.#rxNostr
			.use(this.#rxReqBAd)
			.pipe(
				this.#tie,
				latestEach(
					({ event }) =>
						`${event.kind}:${event.pubkey}:${event.tags.find((tag) => tag.length >= 2 && tag[0] === 'd')?.at(1) ?? ''}`
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

	#mergeFilter7: MergeFilter = (a: LazyFilter[], b: LazyFilter[]) => {
		const margedFilters = [...a, ...b];
		const etags = Array.from(new Set<string>(margedFilters.map((f) => f['#e'] ?? []).flat()));
		const atags = Array.from(new Set<string>(margedFilters.map((f) => f['#a'] ?? []).flat()));
		const f = margedFilters.at(0);
		const res: LazyFilter[] = [];
		if (etags.length > 0) {
			res.push({ kinds: [7], '#e': etags, limit: f?.limit, until: f?.until });
		}
		if (atags.length > 0) {
			res.push({ kinds: [7], '#a': atags, limit: f?.limit, until: f?.until });
		}
		return res;
	};

	#mergeFilter17: MergeFilter = (a: LazyFilter[], b: LazyFilter[]) => {
		const margedFilters = [...a, ...b];
		const rtags = Array.from(new Set<string>(margedFilters.map((f) => f['#r'] ?? []).flat()));
		const f = margedFilters.at(0);
		return [{ kinds: [17], '#r': rtags, limit: f?.limit, until: f?.until }];
	};

	#mergeFilterForAddressableEvents = (
		a: LazyFilter[],
		b: LazyFilter[],
		kind: number
	): LazyFilter[] => {
		const margedFilters = [...a, ...b];
		const newFilters: LazyFilter[] = [];
		const filterMap: Map<string, Set<string>> = new Map<string, Set<string>>();
		for (const filter of margedFilters) {
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
			const filter = { kinds: [kind], authors: [author], '#d': Array.from(dTagSet) };
			newFilters.push(filter);
		}
		return newFilters;
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
		this.#eventStore.add(event);
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

	subscribeEventStore = (callback: (kind: number, event?: NostrEvent) => void) => {
		return this.#eventStore.filters({ since: 0 }).subscribe((event: NostrEvent) => {
			switch (event.kind) {
				case 0: {
					try {
						JSON.parse(event.content);
					} catch (error) {
						console.warn({ error, event });
						return;
					}
					break;
				}
				case 5: {
					this.#eventsDeletion = sortEvents(Array.from(this.#eventStore.getAll([{ kinds: [5] }])));
					break;
				}
				case 7: {
					if (!this.#eventStore.hasReplaceable(0, event.pubkey)) {
						this.#fetchProfile(event.pubkey);
					}
					break;
				}
				case 17: {
					if (!this.#eventStore.hasReplaceable(0, event.pubkey)) {
						this.#fetchProfile(event.pubkey);
					}
					break;
				}
				case 10002: {
					this.#relayRecord = this.#getRelaysToUseFromKind10002Event(event);
					this.#rxNostr.setDefaultRelays(this.#relayRecord);
					break;
				}
				case 10030: {
					this.#fetchEventsByATags(event);
					break;
				}
				case 39701: {
					const d = event.tags.find((tag) => tag.length >= 2 && tag[0] === 'd')?.at(1) ?? '';
					if (!this.isValidWebBookmark(d, event)) {
						return;
					}
					if (!this.#eventStore.hasReplaceable(0, event.pubkey)) {
						this.#fetchProfile(event.pubkey);
					}
					this.#fetchReaction(event);
					this.#fetchWebReaction(`https://${d}`);
					break;
				}
				default:
					break;
			}
			callback(event.kind, event);
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

	#getRelays = (relayType: 'read' | 'write'): string[] => {
		const relaySet = new Set<string>();
		if (this.#relayRecord !== undefined) {
			for (const [relay, _] of Object.entries(this.#relayRecord).filter(([_, obj]) =>
				relayType === 'read' ? obj.read : obj.write
			)) {
				relaySet.add(relay);
			}
		}
		return Array.from(relaySet);
	};

	#fetchProfile = (pubkey: string) => {
		const filter: LazyFilter = {
			kinds: [0],
			authors: [pubkey],
			until: now()
		};
		this.#rxReqB0.emit(filter);
	};

	#fetchReaction = (event: NostrEvent) => {
		let filter: LazyFilter;
		if (isReplaceableKind(event.kind) || isAddressableKind(event.kind)) {
			const ap: nip19.AddressPointer = {
				identifier: event.tags.find((tag) => tag.length >= 2 && tag[0] === 'd')?.at(1) ?? '',
				pubkey: event.pubkey,
				kind: event.kind
			};
			filter = {
				kinds: [7],
				'#a': [`${ap.kind}:${ap.pubkey}:${ap.identifier}`],
				limit: this.#limitReaction,
				until: now()
			};
		} else {
			filter = { kinds: [7], '#e': [event.id], limit: this.#limitReaction, until: now() };
		}
		this.#rxReqB7.emit(filter);
	};

	#fetchWebReaction = (url: string) => {
		this.#rxReqB17.emit({ kinds: [17], '#r': [url], limit: this.#limitReaction, until: now() });
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
		this.#rxReqBRp.emit({
			kinds: [10030],
			authors: [pubkey],
			until: now()
		});
	};

	fetchWebBookmark = (params: UrlParams, loginPubkey?: string) => {
		const { currentAddressPointer, currentProfilePointer, hashtag, path } = params;
		const filterB: LazyFilter = {
			kinds: [39701],
			until: now(),
			limit: 100
		};
		const relaySet: Set<string> = new Set<string>(this.#getRelays('read'));
		if (relaySet.size === 0) {
			for (const relay of defaultRelays) {
				relaySet.add(relay);
			}
		}
		if (currentAddressPointer !== undefined) {
			filterB.kinds = [currentAddressPointer.kind];
			filterB.authors = [currentAddressPointer.pubkey];
			filterB['#d'] = [currentAddressPointer.identifier];
			for (const relay of currentAddressPointer.relays ?? []) {
				relaySet.add(normalizeURL(relay));
			}
		} else if (currentProfilePointer !== undefined) {
			filterB.authors = [currentProfilePointer.pubkey];
			for (const relay of currentProfilePointer.relays ?? []) {
				relaySet.add(normalizeURL(relay));
			}
		}
		if (hashtag !== undefined) {
			filterB['#t'] = [hashtag];
		}
		if (path !== undefined) {
			filterB['#d'] = [path];
		}
		const options: { relays: string[] } = { relays: Array.from(relaySet) };
		this.#rxReqBAd.emit(filterB, options);
		const filterF: LazyFilter = {
			...filterB
		};
		delete filterF.until;
		delete filterF.limit;
		filterF.since = now() + 1;
		const filtersF: LazyFilter[] = [filterF];
		if (loginPubkey !== undefined) {
			filtersF.push({
				kinds: [0, 5, 7, 17, 10002, 10030, 39701],
				authors: [loginPubkey],
				since: now() + 1
			});
		}
		this.#rxReqF.emit(filtersF);
	};

	#fetchEventsByATags = (event: NostrEvent) => {
		const aIds = event.tags.filter((tag) => tag.length >= 2 && tag[0] === 'a').map((tag) => tag[1]);
		const filters = [];
		if (aIds.length > 0) {
			for (const aId of aIds) {
				const ap: nip19.AddressPointer | null = getAddressPointerFromAId(aId);
				if (
					ap !== null &&
					!this.#eventStore.hasReplaceable(
						ap.kind,
						ap.pubkey,
						isAddressableKind(ap.kind) ? ap.identifier : undefined
					)
				) {
					const filter: LazyFilter = {
						kinds: [ap.kind],
						authors: [ap.pubkey],
						until: now()
					};
					if (isAddressableKind(ap.kind)) {
						filter['#d'] = [ap.identifier];
					}
					filters.push(filter);
				}
			}
			let margedFilters: LazyFilter[] = [];
			for (const filter of filters) {
				margedFilters = this.#mergeFilterForAddressableEvents(
					margedFilters,
					[filter],
					filter.kinds?.at(0) ?? -1
				);
			}
			const sliceByNumber = (array: LazyFilter[], number: number) => {
				const length = Math.ceil(array.length / number);
				return new Array(length)
					.fill(undefined)
					.map((_, i) => array.slice(i * number, (i + 1) * number));
			};
			const relayHints: string[] = Array.from(
				new Set<string>(
					event.tags
						.filter(
							(tag) =>
								tag.length >= 3 &&
								tag[0] === 'a' &&
								URL.canParse(tag[2]) &&
								tag[2].startsWith('wss://')
						)
						.map((tag) => normalizeURL(tag[2]))
				)
			);
			const relays: string[] = Array.from(
				new Set<string>([...this.#getRelays('read'), ...relayHints])
			);
			for (const filters of sliceByNumber(margedFilters, 10)) {
				this.#rxReqBRp.emit(filters, { relays });
			}
		}
	};

	getEventsByFilter = (filter: Filter): NostrEvent[] => {
		return Array.from(this.#eventStore.getAll(filter));
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
		const options: Partial<RxNostrSendOptions> = { on: { relays: this.#getRelays('write') } };
		this.#sendEvent(eventToSend, options);
	};

	sendReaction = async (
		targetEvent?: NostrEvent,
		targetUrl?: string,
		content: string = defaultReactionToAdd,
		emojiurl?: string
	): Promise<void> => {
		if (window.nostr === undefined) {
			return;
		}
		const tags: string[][] = [];
		let kind: number;
		if (targetEvent !== undefined) {
			kind = 7;
			const recommendedRelay: string = this.getSeenOn(targetEvent.id, true).at(0) ?? '';
			if (isReplaceableKind(targetEvent.kind) || isAddressableKind(targetEvent.kind)) {
				const d = targetEvent.tags.find((tag) => tag.length >= 2 && tag[0] === 'd')?.at(1) ?? '';
				tags.push(['a', `${targetEvent.kind}:${targetEvent.pubkey}:${d}`, recommendedRelay]);
			}
			tags.push(
				['e', targetEvent.id, recommendedRelay, '', targetEvent.pubkey],
				['p', targetEvent.pubkey],
				['k', String(targetEvent.kind)]
			);
		} else if (targetUrl !== undefined) {
			kind = 17;
			tags.push(['r', targetUrl]);
		} else {
			throw new Error('targetEvent or targetUrl is required');
		}
		if (emojiurl !== undefined && URL.canParse(emojiurl)) {
			tags.push(['emoji', content.replaceAll(':', ''), emojiurl]);
		}
		const eventTemplate: EventTemplate = {
			kind,
			tags,
			content,
			created_at: now()
		};
		const eventToSend = await window.nostr.signEvent(eventTemplate);
		if (!isValidEmoji(eventToSend)) {
			console.warn('emoji is invalid');
			return;
		}
		const relaysToAdd: Set<string> = new Set<string>(this.#getRelays('write'));
		if (isEnabledOutboxModel && targetEvent !== undefined) {
			const relayRecord: RelayRecord = getRelaysToUseFromKind10002Event(
				this.#eventStore.getReplaceable(10002, targetEvent.pubkey)
			);
			for (const [relayUrl, _] of Object.entries(relayRecord).filter(([_, obj]) => obj.read)) {
				relaysToAdd.add(relayUrl);
			}
		}
		const options: Partial<RxNostrSendOptions> = { on: { relays: Array.from(relaysToAdd) } };
		this.#sendEvent(eventToSend, options);
	};

	sendDeletion = async (targetEvent: NostrEvent): Promise<void> => {
		if (window.nostr === undefined) {
			return;
		}
		const tags = [
			['e', targetEvent.id],
			['k', String(targetEvent.kind)]
		];
		const eventTemplate: EventTemplate = {
			kind: 5,
			tags,
			content: '',
			created_at: now()
		};
		const eventToSend = await window.nostr.signEvent(eventTemplate);
		const relaysToAdd: Set<string> = new Set<string>(this.#getRelays('write'));
		if (isEnabledOutboxModel) {
			const mentionedPubkeys: string[] = targetEvent.tags
				.filter((tag) => tag.length >= 2 && tag[0] === 'p')
				.map((tag) => tag[1]);
			for (const pubkey of mentionedPubkeys) {
				const relayRecord: RelayRecord = getRelaysToUseFromKind10002Event(
					this.#eventStore.getReplaceable(10002, pubkey)
				);
				for (const [relayUrl, _] of Object.entries(relayRecord).filter(([_, obj]) => obj.read)) {
					relaysToAdd.add(relayUrl);
				}
			}
		}
		const options: Partial<RxNostrSendOptions> = { on: { relays: Array.from(relaysToAdd) } };
		this.#sendEvent(eventToSend, options);
	};

	#sendEvent = (eventToSend: NostrEvent, options?: Partial<RxNostrSendOptions>): void => {
		this.#rxNostr.send(eventToSend, options);
	};
}
