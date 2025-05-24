import {
	bufferTime,
	type MonoTypeOperatorFunction,
	type OperatorFunction,
	type Subscription
} from 'rxjs';
import {
	batch,
	completeOnTimeout,
	createRxBackwardReq,
	createRxForwardReq,
	createRxNostr,
	createTie,
	createUniq,
	latestEach,
	now,
	type EventPacket,
	type LazyFilter,
	type MergeFilter,
	type ReqPacket,
	type RxNostr,
	type RxNostrSendOptions,
	type RxReq,
	type RxReqEmittable,
	type RxReqOverable,
	type RxReqPipeable
} from 'rx-nostr';
import { verifier } from '@rx-nostr/crypto';
import { EventStore } from 'applesauce-core';
import { getTagValue } from 'applesauce-core/helpers';
import { sortEvents, type EventTemplate, type NostrEvent } from 'nostr-tools/pure';
import { isAddressableKind, isReplaceableKind } from 'nostr-tools/kinds';
import type { RelayRecord } from 'nostr-tools/relay';
import type { Filter } from 'nostr-tools/filter';
import { normalizeURL } from 'nostr-tools/utils';
import * as nip19 from 'nostr-tools/nip19';
import {
	defaultReactionToAdd,
	defaultRelays,
	isEnabledOutboxModel,
	indexerRelays
} from '$lib/config';
import {
	getAddressPointerFromAId,
	getRelaysToUseFromKind10002Event,
	isValidEmoji,
	isValidWebBookmark,
	splitNip51List
} from '$lib/utils';

export type UrlParams = {
	isError?: boolean;
	currentProfilePointer?: nip19.ProfilePointer;
	currentAddressPointer?: nip19.AddressPointer;
	currentEventPointer?: nip19.EventPointer;
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
	#rxReqB5: ReqB;
	#rxReqB7: ReqB;
	#rxReqB17: ReqB;
	#rxReqB1111: ReqB;
	#rxReqB10002: ReqB;
	#rxReqB39701Url: ReqB;
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
	#uniq: MonoTypeOperatorFunction<EventPacket>;
	#eventIds: Set<string>;
	#secOnCompleteTimeout = 1000;
	#secBufferTime = 1000;
	#limitReaction = 100;
	#limitComment = 100;

	#eventsDeletion: NostrEvent[];

	constructor(useAuth: boolean) {
		if (useAuth) {
			this.#rxNostr = createRxNostr({ verifier, authenticator: 'auto' });
		} else {
			this.#rxNostr = createRxNostr({ verifier });
		}
		this.#eventStore = new EventStore();
		this.#rxReqB0 = createRxBackwardReq();
		this.#rxReqB5 = createRxBackwardReq();
		this.#rxReqB7 = createRxBackwardReq();
		this.#rxReqB17 = createRxBackwardReq();
		this.#rxReqB1111 = createRxBackwardReq();
		this.#rxReqB10002 = createRxBackwardReq();
		this.#rxReqB39701Url = createRxBackwardReq();
		this.#rxReqBRp = createRxBackwardReq();
		this.#rxReqBAd = createRxBackwardReq();
		this.#rxReqF = createRxForwardReq();
		[this.#tie, this.#seenOn] = createTie();
		[this.#uniq, this.#eventIds] = createUniq((packet: EventPacket): string => packet.event.id);
		this.#rxNostr.setDefaultRelays(defaultRelays);
		this.#defineSubscription();
		this.#eventsDeletion = [];
	}

	dispose = () => {
		this.#seenOn.clear();
		this.#eventIds.clear();
		this.#rxNostr.dispose();
		for (const ev of this.#eventStore.getAll({ since: 0 })) {
			this.#eventStore.database.removeEvent(ev);
		}
	};

	#defineSubscription = () => {
		const getRpId = ({ event }: { event: NostrEvent }) => `${event.kind}:${event.pubkey}`;
		const getAdId = ({ event }: { event: NostrEvent }) =>
			`${event.kind}:${event.pubkey}:${getTagValue(event, 'd') ?? ''}`;
		const next = this.#next;
		const complete = this.#complete;
		const bt: OperatorFunction<ReqPacket, ReqPacket[]> = bufferTime(this.#secBufferTime);
		const batchedReq0 = this.#rxReqB0.pipe(bt, batch(this.#mergeFilterRp));
		const batchedReq5 = this.#rxReqB5.pipe(bt, batch(this.#mergeFilterRg));
		const batchedReq7 = this.#rxReqB7.pipe(bt, batch(this.#mergeFilterRg));
		const batchedReq17 = this.#rxReqB17.pipe(bt, batch(this.#mergeFilter17));
		const batchedReq1111 = this.#rxReqB1111.pipe(bt, batch(this.#mergeFilter1111));
		const batchedReq10002 = this.#rxReqB10002.pipe(bt, batch(this.#mergeFilterRp));
		const batchedReq39701Url = this.#rxReqB39701Url.pipe(bt, batch(this.#mergeFilter39701Url));
		this.#rxNostr.use(batchedReq0).pipe(this.#tie, latestEach(getRpId)).subscribe({
			next,
			complete
		});
		this.#rxNostr.use(batchedReq5).pipe(this.#tie, this.#uniq).subscribe({
			next,
			complete
		});
		this.#rxNostr.use(batchedReq7).pipe(this.#tie, this.#uniq).subscribe({
			next,
			complete
		});
		this.#rxNostr.use(batchedReq17).pipe(this.#tie, this.#uniq).subscribe({
			next,
			complete
		});
		this.#rxNostr.use(batchedReq1111).pipe(this.#tie, this.#uniq).subscribe({
			next,
			complete
		});
		this.#rxNostr.use(batchedReq10002).pipe(this.#tie, latestEach(getRpId)).subscribe({
			next,
			complete
		});
		this.#rxNostr.use(batchedReq39701Url).pipe(this.#tie, latestEach(getAdId)).subscribe({
			next,
			complete
		});
		this.#rxNostr.use(this.#rxReqBRp).pipe(this.#tie, latestEach(getRpId)).subscribe({
			next,
			complete
		});
		this.#rxNostr.use(this.#rxReqBAd).pipe(this.#tie, latestEach(getAdId)).subscribe({
			next,
			complete
		});
		this.#rxNostr.use(this.#rxReqF).pipe(this.#tie, this.#uniq).subscribe({
			next,
			complete
		});
	};

	#mergeFilterRp: MergeFilter = (a: LazyFilter[], b: LazyFilter[]) => {
		const margedFilters = [...a, ...b];
		const authors = Array.from(new Set<string>(margedFilters.map((f) => f.authors ?? []).flat()));
		const f = margedFilters.at(0);
		return [
			{ kinds: f?.kinds, authors: authors, limit: f?.limit, until: f?.until, since: f?.since }
		];
	};

	#mergeFilterRg: MergeFilter = (a: LazyFilter[], b: LazyFilter[]) => {
		const margedFilters = [...a, ...b];
		const etags = Array.from(new Set<string>(margedFilters.map((f) => f['#e'] ?? []).flat()));
		const atags = Array.from(new Set<string>(margedFilters.map((f) => f['#a'] ?? []).flat()));
		const f = margedFilters.at(0);
		const res: LazyFilter[] = [];
		if (f !== undefined) {
			if (etags.length > 0) {
				res.push({ kinds: f.kinds, '#e': etags, limit: f.limit, until: f.until });
			}
			if (atags.length > 0) {
				res.push({ kinds: f.kinds, '#a': atags, limit: f.limit, until: f.until });
			}
		}
		return res;
	};

	#mergeFilter17: MergeFilter = (a: LazyFilter[], b: LazyFilter[]) => {
		const margedFilters = [...a, ...b];
		const rtags = Array.from(new Set<string>(margedFilters.map((f) => f['#r'] ?? []).flat()));
		const f = margedFilters.at(0);
		return [{ kinds: [17], '#r': rtags, limit: f?.limit, until: f?.until }];
	};

	#mergeFilter1111: MergeFilter = (a: LazyFilter[], b: LazyFilter[]) => {
		const margedFilters = [...a, ...b];
		const Etags = Array.from(new Set<string>(margedFilters.map((f) => f['#E'] ?? []).flat()));
		const Atags = Array.from(new Set<string>(margedFilters.map((f) => f['#A'] ?? []).flat()));
		const f = margedFilters.at(0);
		const res: LazyFilter[] = [];
		if (f !== undefined) {
			if (Etags.length > 0) {
				res.push({ kinds: f.kinds, '#E': Etags, limit: f.limit, until: f.until });
			}
			if (Atags.length > 0) {
				res.push({ kinds: f.kinds, '#A': Atags, limit: f.limit, until: f.until });
			}
		}
		return res;
	};

	#mergeFilter39701Url: MergeFilter = (a: LazyFilter[], b: LazyFilter[]) => {
		const margedFilters = [...a, ...b];
		const dtags = Array.from(new Set<string>(margedFilters.map((f) => f['#d'] ?? []).flat()));
		const f = margedFilters.at(0);
		return [{ kinds: [39701], '#d': dtags, limit: f?.limit, until: f?.until }];
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
			const relaysSeenOnSet = new Set<string>();
			for (const id of ids) {
				if (this.#eventStore.hasEvent(id)) {
					for (const relay of this.getSeenOn(id, true)) {
						relaysSeenOnSet.add(relay);
					}
					this.#eventStore.database.removeEvent(id);
				}
			}
			for (const relay of this.getSeenOn(event.id, true)) {
				relaysSeenOnSet.delete(relay);
			}
			//削除対象イベント取得元のリレーにkind:5をブロードキャスト
			if (relaysSeenOnSet.size > 0) {
				const options: Partial<RxNostrSendOptions> = {
					on: { relays: Array.from(relaysSeenOnSet) }
				};
				this.#sendEvent(event, options);
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

	subscribeEventStore = (callback: (kind: number, event?: NostrEvent) => void): Subscription => {
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
					this.#fetchDeletion(event);
					break;
				}
				case 17: {
					if (!this.#eventStore.hasReplaceable(0, event.pubkey)) {
						this.#fetchProfile(event.pubkey);
					}
					this.#fetchDeletion(event);
					break;
				}
				case 1111: {
					if (!this.#eventStore.hasReplaceable(0, event.pubkey)) {
						this.#fetchProfile(event.pubkey);
					}
					if (!this.#eventStore.hasReplaceable(10002, event.pubkey)) {
						this.#fetchRelayList(event.pubkey);
					}
					this.#fetchDeletion(event);
					this.#fetchReaction(event);
					this.#fetchEventsByATags(event, 'A');
					break;
				}
				case 10002: {
					if (!this.#eventStore.hasReplaceable(0, event.pubkey)) {
						this.#fetchProfile(event.pubkey);
					}
					break;
				}
				case 10030: {
					this.#fetchEventsByATags(event, 'a');
					break;
				}
				case 39701: {
					const d = getTagValue(event, 'd') ?? '';
					if (!isValidWebBookmark(d, event)) {
						return;
					}
					if (!this.#eventStore.hasReplaceable(0, event.pubkey)) {
						this.#fetchProfile(event.pubkey);
					}
					if (!this.#eventStore.hasReplaceable(10002, event.pubkey)) {
						this.#fetchRelayList(event.pubkey);
					}
					const filter = { kinds: [39701], '#d': [d] };
					if (this.#eventStore.getAll(filter).size === 1) {
						this.#rxReqB39701Url.emit(filter);
					}
					this.#fetchDeletion(event);
					this.#fetchReaction(event);
					this.#fetchWebReaction(`https://${d}`);
					this.#fetchComment(event);
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

	setRelays = (event?: NostrEvent) => {
		if (event === undefined) {
			this.#relayRecord = undefined;
			this.#rxNostr.setDefaultRelays(defaultRelays);
		} else {
			this.#relayRecord = this.#getRelaysToUseFromKind10002Event(event);
			this.#rxNostr.setDefaultRelays(this.#relayRecord);
		}
	};

	#fetchProfile = (pubkey: string) => {
		const filter: LazyFilter = {
			kinds: [0],
			authors: [pubkey],
			until: now()
		};
		this.#rxReqB0.emit(filter);
	};

	#fetchDeletion = (event: NostrEvent) => {
		this.#rxReqB5.emit({ kinds: [5], '#e': [event.id], until: now() });
	};

	#fetchReaction = (event: NostrEvent) => {
		let filter: LazyFilter;
		if (isReplaceableKind(event.kind) || isAddressableKind(event.kind)) {
			const ap: nip19.AddressPointer = {
				identifier: getTagValue(event, 'd') ?? '',
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

	#fetchComment = (event: NostrEvent) => {
		let filter: LazyFilter;
		if (isReplaceableKind(event.kind) || isAddressableKind(event.kind)) {
			const ap: nip19.AddressPointer = {
				identifier: getTagValue(event, 'd') ?? '',
				pubkey: event.pubkey,
				kind: event.kind
			};
			filter = {
				kinds: [1111],
				'#A': [`${ap.kind}:${ap.pubkey}:${ap.identifier}`],
				limit: this.#limitComment,
				until: now()
			};
		} else {
			filter = { kinds: [1111], '#E': [event.id], limit: this.#limitComment, until: now() };
		}
		this.#rxReqB1111.emit(filter);
	};

	#fetchRelayList = (pubkey: string) => {
		const filter: LazyFilter = {
			kinds: [10002],
			authors: [pubkey],
			until: now()
		};
		this.#rxReqB10002.emit(filter);
	};

	fetchKind10002 = (pubkeys: string[], completeCustom: () => void) => {
		const filter: LazyFilter = {
			kinds: [10002],
			authors: pubkeys,
			until: now()
		};
		const options = { relays: indexerRelays };
		const rxReqBRpCustom = createRxBackwardReq();
		this.#rxNostr
			.use(rxReqBRpCustom, options)
			.pipe(
				this.#tie,
				latestEach(({ event }) => `${event.kind}:${event.pubkey}`),
				completeOnTimeout(this.#secOnCompleteTimeout)
			)
			.subscribe({
				next: this.#next,
				complete: completeCustom
			});
		rxReqBRpCustom.emit(filter);
		rxReqBRpCustom.over();
	};

	fetchUserSettings = (pubkey: string) => {
		this.#rxReqBRp.emit({
			kinds: [10000, 10030],
			authors: [pubkey],
			until: now()
		});
	};

	fetchWebBookmark = (
		params: UrlParams,
		loginPubkey?: string,
		unitl?: number,
		completeCustom?: () => void
	) => {
		const { currentAddressPointer, currentProfilePointer, currentEventPointer, hashtag, path } =
			params;
		const filterB: LazyFilter = {
			kinds: [39701],
			until: unitl ?? now(),
			limit: unitl === undefined ? 10 : 11
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
		} else if (currentEventPointer !== undefined) {
			filterB.kinds =
				currentEventPointer.kind === undefined ? undefined : [currentEventPointer.kind];
			filterB.authors =
				currentEventPointer.author === undefined ? undefined : [currentEventPointer.author];
			filterB.ids = [currentEventPointer.id];
			for (const relay of currentEventPointer.relays ?? []) {
				relaySet.add(normalizeURL(relay));
			}
		}
		if (hashtag !== undefined) {
			filterB['#t'] = [hashtag];
		}
		if (path !== undefined) {
			filterB['#d'] = [path];
		}
		if (filterB.authors !== undefined && isEnabledOutboxModel) {
			for (const pubkey of filterB.authors) {
				const relayRecord: RelayRecord = getRelaysToUseFromKind10002Event(
					this.#eventStore.getReplaceable(10002, pubkey)
				);
				for (const [relayUrl, _] of Object.entries(relayRecord).filter(([_, obj]) => obj.read)) {
					relaySet.add(relayUrl);
				}
			}
		}
		const options: { relays: string[] } = { relays: Array.from(relaySet) };
		if (completeCustom !== undefined) {
			const rxReqBAdCustom = createRxBackwardReq();
			this.#rxNostr
				.use(rxReqBAdCustom)
				.pipe(
					this.#tie,
					latestEach(
						({ event }) => `${event.kind}:${event.pubkey}:${getTagValue(event, 'd') ?? ''}`
					),
					completeOnTimeout(this.#secOnCompleteTimeout)
				)
				.subscribe({
					next: this.#next,
					complete: completeCustom
				});
			rxReqBAdCustom.emit(filterB, options);
			rxReqBAdCustom.over();
			return; //追加読み込みはここで終了
		} else {
			this.#rxReqBAd.emit(filterB, options);
		}
		const filterF: LazyFilter = {
			...filterB
		};
		delete filterF.until;
		delete filterF.limit;
		filterF.since = now() + 1;
		const filtersF: LazyFilter[] = [filterF];
		if (loginPubkey !== undefined) {
			filtersF.push({
				kinds: [0, 5, 7, 17, 1111, 10002, 10030, 39701],
				authors: [loginPubkey],
				since: now() + 1
			});
		}
		this.#rxReqF.emit(filtersF);
	};

	#fetchEventsByATags = (event: NostrEvent, tagName: string) => {
		const aIds = event.tags
			.filter((tag) => tag.length >= 2 && tag[0] === tagName)
			.map((tag) => tag[1]);
		if (aIds.length === 0) {
			return;
		}
		const filters = [];
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
							tag[0] === tagName &&
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
			this.#rxReqBAd.emit(filters, { relays });
		}
	};

	getEventsByFilter = (filters: Filter | Filter[]): NostrEvent[] => {
		return Array.from(this.#eventStore.getAll(filters));
	};

	getReplaceableEvent = (kind: number, pubkey: string, d?: string): NostrEvent | undefined => {
		return this.#eventStore.getReplaceable(kind, pubkey, d);
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

	signAndSendEvent = async (eventTemplate: EventTemplate): Promise<void> => {
		if (window.nostr === undefined) {
			return;
		}
		const eventToSend = await window.nostr.signEvent(eventTemplate);
		this.#sendEvent(eventToSend);
	};

	mutePubkey = async (
		pubkey: string,
		loginPubkey: string,
		eventMuteList: NostrEvent | undefined
	): Promise<void> => {
		if (window.nostr?.nip04 === undefined) {
			return;
		}
		const kind = 10000;
		let tags: string[][];
		let content: string;
		if (eventMuteList === undefined) {
			tags = [];
			content = await window.nostr.nip04.encrypt(loginPubkey, JSON.stringify([['p', pubkey]]));
		} else {
			const { tagList, contentList } = await splitNip51List(eventMuteList, loginPubkey);
			tags = tagList;
			content = await window.nostr.nip04.encrypt(
				loginPubkey,
				JSON.stringify([...contentList, ['p', pubkey]])
			);
		}
		const eventTemplate: EventTemplate = {
			kind,
			tags,
			content,
			created_at: now()
		};
		const eventToSend = await window.nostr.signEvent(eventTemplate);
		this.#sendEvent(eventToSend);
	};

	unmutePubkey = async (
		pubkey: string,
		loginPubkey: string,
		eventMuteList: NostrEvent | undefined
	): Promise<void> => {
		if (window.nostr?.nip04 === undefined) {
			return;
		}
		if (eventMuteList === undefined) {
			console.warn('kind:10000 event does not exist');
			return;
		}
		const { tagList, contentList } = await splitNip51List(eventMuteList, loginPubkey);
		const tags: string[][] = tagList.filter(
			(tag) => !(tag.length >= 2 && tag[0] === 'p' && tag[1] === pubkey)
		);
		const content: string = !contentList.some(
			(tag) => tag.length >= 2 && tag[0] === 'p' && tag[1] === pubkey
		)
			? eventMuteList.content
			: await window.nostr.nip04.encrypt(
					loginPubkey,
					JSON.stringify(
						contentList.filter((tag) => !(tag.length >= 2 && tag[0] === 'p' && tag[1] === pubkey))
					)
				);
		const eventTemplate: EventTemplate = {
			kind: eventMuteList.kind,
			tags,
			content,
			created_at: now()
		};
		const eventToSend = await window.nostr.signEvent(eventTemplate);
		this.#sendEvent(eventToSend);
	};

	muteHashtag = async (
		hashtag: string,
		loginPubkey: string,
		eventMuteList: NostrEvent | undefined
	): Promise<void> => {
		if (window.nostr?.nip04 === undefined) {
			return;
		}
		const kind = 10000;
		let tags: string[][];
		let content: string;
		if (eventMuteList === undefined) {
			tags = [];
			content = await window.nostr.nip04.encrypt(loginPubkey, JSON.stringify([['t', hashtag]]));
		} else {
			const { tagList, contentList } = await splitNip51List(eventMuteList, loginPubkey);
			tags = tagList;
			content = await window.nostr.nip04.encrypt(
				loginPubkey,
				JSON.stringify([...contentList, ['t', hashtag]])
			);
		}
		const eventTemplate: EventTemplate = {
			kind,
			tags,
			content,
			created_at: now()
		};
		const eventToSend = await window.nostr.signEvent(eventTemplate);
		this.#sendEvent(eventToSend);
	};

	unmuteHashtag = async (
		hashtag: string,
		loginPubkey: string,
		eventMuteList: NostrEvent | undefined
	): Promise<void> => {
		if (window.nostr?.nip04 === undefined) {
			return;
		}
		if (eventMuteList === undefined) {
			console.warn('kind:10000 event does not exist');
			return;
		}
		const { tagList, contentList } = await splitNip51List(eventMuteList, loginPubkey);
		const tags: string[][] = tagList.filter(
			(tag) => !(tag.length >= 2 && tag[0] === 't' && tag[1].toLowerCase() === hashtag)
		);
		const content: string = !contentList.some(
			(tag) => tag.length >= 2 && tag[0] === 't' && tag[1].toLowerCase() === hashtag
		)
			? eventMuteList.content
			: await window.nostr.nip04.encrypt(
					loginPubkey,
					JSON.stringify(
						contentList.filter(
							(tag) => !(tag.length >= 2 && tag[0] === 't' && tag[1].toLowerCase() === hashtag)
						)
					)
				);
		const eventTemplate: EventTemplate = {
			kind: eventMuteList.kind,
			tags,
			content,
			created_at: now()
		};
		const eventToSend = await window.nostr.signEvent(eventTemplate);
		this.#sendEvent(eventToSend);
	};

	sendComment = async (content: string, targetEventToReply: NostrEvent): Promise<void> => {
		if (window.nostr === undefined) {
			return;
		}
		const kind = 1111;
		const tags: string[][] = [];
		const recommendedRelay: string = this.getSeenOn(targetEventToReply.id, true).at(0) ?? '';
		if (targetEventToReply.kind === 1111) {
			const tagsCopied = targetEventToReply.tags.filter(
				(tag) => tag.length >= 2 && ['A', 'E', 'I', 'K', 'P'].includes(tag[0])
			);
			for (const tag of tagsCopied) {
				tags.push([...tag]);
			}
			tags.push(['e', targetEventToReply.id, recommendedRelay, targetEventToReply.pubkey]);
			tags.push(['k', String(targetEventToReply.kind)]);
		} else if (
			isReplaceableKind(targetEventToReply.kind) ||
			isAddressableKind(targetEventToReply.kind)
		) {
			const d = getTagValue(targetEventToReply, 'd') ?? '';
			const a = `${targetEventToReply.kind}:${targetEventToReply.pubkey}:${d}`;
			tags.push(['A', a, recommendedRelay]);
			tags.push(['K', String(targetEventToReply.kind)]);
			tags.push(['P', targetEventToReply.pubkey]);
			tags.push(['a', a, recommendedRelay]);
			tags.push(['e', targetEventToReply.id, recommendedRelay, targetEventToReply.pubkey]);
			tags.push(['k', String(targetEventToReply.kind)]);
			tags.push(['p', targetEventToReply.pubkey]);
		} else {
			tags.push(['E', targetEventToReply.id, recommendedRelay, targetEventToReply.pubkey]);
			tags.push(['K', String(targetEventToReply.kind)]);
			tags.push(['P', targetEventToReply.pubkey]);
			tags.push(['e', targetEventToReply.id, recommendedRelay, targetEventToReply.pubkey]);
			tags.push(['k', String(targetEventToReply.kind)]);
			tags.push(['p', targetEventToReply.pubkey]);
		}
		const eventTemplate: EventTemplate = {
			kind,
			tags,
			content,
			created_at: now()
		};
		const eventToSend = await window.nostr.signEvent(eventTemplate);
		const relaySet: Set<string> = new Set<string>(this.#getRelays('write'));
		if (isEnabledOutboxModel) {
			const relayRecord: RelayRecord = getRelaysToUseFromKind10002Event(
				this.#eventStore.getReplaceable(10002, targetEventToReply.pubkey)
			);
			for (const [relayUrl, _] of Object.entries(relayRecord).filter(([_, obj]) => obj.read)) {
				relaySet.add(relayUrl);
			}
		}
		const options: Partial<RxNostrSendOptions> = { on: { relays: Array.from(relaySet) } };
		this.#sendEvent(eventToSend, options);
	};

	sendReaction = async (
		target: NostrEvent | string,
		content: string = defaultReactionToAdd,
		emojiurl?: string
	): Promise<void> => {
		if (window.nostr === undefined) {
			return;
		}
		let targetEvent: NostrEvent | undefined;
		let targetUrl: string | undefined;
		let kind: number;
		const tags: string[][] = [];
		if (typeof target !== 'string') {
			targetEvent = target;
			kind = 7;
			const recommendedRelayForTargetEvent: string =
				this.getSeenOn(targetEvent.id, true).at(0) ?? '';
			const recommendedRelayForAuthor: string =
				this.getSeenOn(this.getReplaceableEvent(0, targetEvent.pubkey)?.id ?? '', true).at(0) ?? '';
			if (isReplaceableKind(targetEvent.kind) || isAddressableKind(targetEvent.kind)) {
				const d = getTagValue(targetEvent, 'd') ?? '';
				tags.push([
					'a',
					`${targetEvent.kind}:${targetEvent.pubkey}:${d}`,
					recommendedRelayForTargetEvent
				]);
			}
			tags.push(
				['e', targetEvent.id, recommendedRelayForTargetEvent, targetEvent.pubkey],
				['p', targetEvent.pubkey, recommendedRelayForAuthor],
				['k', String(targetEvent.kind)]
			);
		} else {
			targetUrl = target;
			kind = 17;
			tags.push(['r', targetUrl]);
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
		const relaySet: Set<string> = new Set<string>(this.#getRelays('write'));
		if (isEnabledOutboxModel && targetEvent !== undefined) {
			const relayRecord: RelayRecord = getRelaysToUseFromKind10002Event(
				this.#eventStore.getReplaceable(10002, targetEvent.pubkey)
			);
			for (const [relayUrl, _] of Object.entries(relayRecord).filter(([_, obj]) => obj.read)) {
				relaySet.add(relayUrl);
			}
		}
		const options: Partial<RxNostrSendOptions> = { on: { relays: Array.from(relaySet) } };
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
		const relaySet: Set<string> = new Set<string>(this.#getRelays('write'));
		if (isEnabledOutboxModel) {
			const mentionedPubkeys: string[] = targetEvent.tags
				.filter((tag) => tag.length >= 2 && tag[0] === 'p')
				.map((tag) => tag[1]);
			for (const pubkey of mentionedPubkeys) {
				const relayRecord: RelayRecord = getRelaysToUseFromKind10002Event(
					this.#eventStore.getReplaceable(10002, pubkey)
				);
				for (const [relayUrl, _] of Object.entries(relayRecord).filter(([_, obj]) => obj.read)) {
					relaySet.add(relayUrl);
				}
			}
		}
		const options: Partial<RxNostrSendOptions> = { on: { relays: Array.from(relaySet) } };
		this.#sendEvent(eventToSend, options);
	};

	#sendEvent = (eventToSend: NostrEvent, options?: Partial<RxNostrSendOptions>): void => {
		this.#rxNostr.send(eventToSend, options);
	};
}
