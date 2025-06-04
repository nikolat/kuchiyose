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
	type ConnectionStatePacket,
	type EventPacket,
	type LazyFilter,
	type MergeFilter,
	type ReqPacket,
	type RetryConfig,
	type RxNostr,
	type RxNostrSendOptions,
	type RxNostrUseOptions,
	type RxReq,
	type RxReqEmittable,
	type RxReqOverable,
	type RxReqPipeable
} from 'rx-nostr';
import { verifier } from '@rx-nostr/crypto';
import { EventStore } from 'applesauce-core';
import {
	getAddressPointerForEvent,
	getAddressPointerFromATag,
	getCoordinateFromAddressPointer,
	getDeleteCoordinates,
	getDeleteIds,
	getInboxes,
	getOutboxes,
	getTagValue,
	parseCoordinate,
	unixNow
} from 'applesauce-core/helpers';
import { sortEvents, type EventTemplate, type NostrEvent } from 'nostr-tools/pure';
import { isAddressableKind, isReplaceableKind } from 'nostr-tools/kinds';
import type { RelayRecord } from 'nostr-tools/relay';
import type { Filter } from 'nostr-tools/filter';
import { normalizeURL } from 'nostr-tools/utils';
import * as nip19 from 'nostr-tools/nip19';
import { defaultRelays, indexerRelays, profileRelays } from '$lib/config';
import {
	getIdsForFilter,
	getPubkeysForFilter,
	getReadRelaysWithOutboxModel,
	getTagsForContent,
	isValidEmoji,
	isValidWebBookmark,
	mergeFilterForAddressableEvents,
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
	#rxReqB39701Url: ReqB;
	#rxReqBIdQ: ReqB;
	#rxReqBRp: ReqB;
	#rxReqBRpQ: ReqB;
	#rxReqBAd: ReqB;
	#rxReqBAdQ: ReqB;
	#rxReqF: ReqF;
	#deadRelays: string[];
	#blockedRelays: string[];
	#eventsDeletion: NostrEvent[];
	#callbackQuote: (event: NostrEvent) => void;
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

	constructor(
		useAuth: boolean,
		callbackConnectionState: (packet: ConnectionStatePacket) => void,
		callbackQuote: (event: NostrEvent) => void
	) {
		const retry: RetryConfig = {
			strategy: 'exponential',
			maxCount: 3,
			initialDelay: 1000,
			polite: true
		};
		if (useAuth) {
			this.#rxNostr = createRxNostr({ verifier, retry, authenticator: 'auto' });
		} else {
			this.#rxNostr = createRxNostr({ verifier, retry });
		}
		this.#eventStore = new EventStore();
		this.#rxReqB0 = createRxBackwardReq();
		this.#rxReqB5 = createRxBackwardReq();
		this.#rxReqB7 = createRxBackwardReq();
		this.#rxReqB17 = createRxBackwardReq();
		this.#rxReqB1111 = createRxBackwardReq();
		this.#rxReqB39701Url = createRxBackwardReq();
		this.#rxReqBIdQ = createRxBackwardReq();
		this.#rxReqBRp = createRxBackwardReq();
		this.#rxReqBRpQ = createRxBackwardReq();
		this.#rxReqBAd = createRxBackwardReq();
		this.#rxReqBAdQ = createRxBackwardReq();
		this.#rxReqF = createRxForwardReq();
		this.#deadRelays = [];
		this.#blockedRelays = [];
		this.#eventsDeletion = [];
		this.#callbackQuote = callbackQuote;
		[this.#tie, this.#seenOn] = createTie();
		[this.#uniq, this.#eventIds] = createUniq((packet: EventPacket): string => packet.event.id);

		this.#rxNostr.setDefaultRelays(defaultRelays);
		this.#rxNostr.createConnectionStateObservable().subscribe(callbackConnectionState);
		this.#defineSubscription();
	}

	dispose = () => {
		this.#seenOn.clear();
		this.#eventIds.clear();
		this.#rxNostr.dispose();
		for (const ev of this.#eventStore.getAll({ since: 0 })) {
			this.#eventStore.database.removeEvent(ev);
		}
	};

	setDeadRelays = (deadRelays: string[]): void => {
		this.#deadRelays = deadRelays;
	};

	setBlockedRelays = (blockedRelays: string[]): void => {
		this.#blockedRelays = blockedRelays;
	};

	relayFilter = (relay: string) =>
		relay.startsWith('wss://') &&
		!this.#deadRelays.includes(relay) &&
		!this.#blockedRelays.includes(relay);

	#defineSubscription = () => {
		const getRpId = ({ event }: { event: NostrEvent }) => `${event.kind}:${event.pubkey}`;
		const getAdId = ({ event }: { event: NostrEvent }) =>
			getCoordinateFromAddressPointer(getAddressPointerForEvent(event));
		const next = this.#next;
		const complete = this.#complete;
		const bt: OperatorFunction<ReqPacket, ReqPacket[]> = bufferTime(this.#secBufferTime);
		const batchedReq0 = this.#rxReqB0.pipe(bt, batch(this.#mergeFilterRp));
		const batchedReq5 = this.#rxReqB5.pipe(bt, batch(this.#mergeFilterRg));
		const batchedReq7 = this.#rxReqB7.pipe(bt, batch(this.#mergeFilterRg));
		const batchedReq17 = this.#rxReqB17.pipe(bt, batch(this.#mergeFilter17));
		const batchedReq1111 = this.#rxReqB1111.pipe(bt, batch(this.#mergeFilter1111));
		const batchedReq39701Url = this.#rxReqB39701Url.pipe(bt, batch(this.#mergeFilter39701Url));
		const batchedReqIdQ = this.#rxReqBIdQ.pipe(bt, batch(this.#mergeFilterId));
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
		this.#rxNostr.use(batchedReq39701Url).pipe(this.#tie, latestEach(getAdId)).subscribe({
			next,
			complete
		});
		this.#rxNostr.use(batchedReqIdQ).pipe(this.#tie, this.#uniq).subscribe({
			next: this.#nextCallbackQuote,
			complete
		});
		this.#rxNostr.use(this.#rxReqBRp).pipe(this.#tie, latestEach(getRpId)).subscribe({
			next,
			complete
		});
		this.#rxNostr.use(this.#rxReqBRpQ).pipe(this.#tie, latestEach(getRpId)).subscribe({
			next: this.#nextCallbackQuote,
			complete
		});
		this.#rxNostr.use(this.#rxReqBAd).pipe(this.#tie, latestEach(getAdId)).subscribe({
			next,
			complete
		});
		this.#rxNostr.use(this.#rxReqBAdQ).pipe(this.#tie, latestEach(getAdId)).subscribe({
			next: this.#nextCallbackQuote,
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

	#mergeFilterId: MergeFilter = (a: LazyFilter[], b: LazyFilter[]) => {
		const margedFilters = [...a, ...b];
		const ids = Array.from(new Set<string>(margedFilters.map((f) => f.ids ?? []).flat()));
		const f = margedFilters.at(0);
		return [{ ids: ids, limit: f?.limit, until: f?.until, since: f?.since }];
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
			const ids: string[] = getDeleteIds(event);
			const aids: string[] = getDeleteCoordinates(event);
			const relaysSeenOnSet = new Set<string>();
			for (const id of ids) {
				if (this.#eventStore.hasEvent(id)) {
					for (const relay of this.getSeenOn(id, true)) {
						relaysSeenOnSet.add(relay);
					}
					this.#eventStore.database.removeEvent(id);
				}
			}
			for (const aid of aids) {
				const ap: nip19.AddressPointer | null = parseCoordinate(aid, true, true);
				if (ap === null) {
					continue;
				}
				const filter: Filter = {
					kinds: [ap.kind],
					authors: [ap.pubkey],
					until: event.created_at
				};
				if (ap.identifier.length > 0) {
					filter['#d'] = [ap.identifier];
				}
				const evs: Set<NostrEvent> = this.#eventStore.getAll(filter);
				for (const ev of evs) {
					for (const relay of this.getSeenOn(ev.id, true)) {
						relaysSeenOnSet.add(relay);
					}
					this.#eventStore.database.removeEvent(ev.id);
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
		} else if (event.kind === 39701) {
			isValidWebBookmark(getTagValue(event, 'd') ?? '', event); //log only
		}
		this.#eventStore.add(event);
	};

	#nextCallbackQuote = (packet: EventPacket): void => {
		this.#callbackQuote(packet.event);
		this.#next(packet);
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

	setFetchListAfter0 = (pubkey: string, fetchAfter0: () => void): void => {
		if (!this.#eventStore.hasReplaceable(0, pubkey)) {
			this.fetchProfile(pubkey, fetchAfter0);
		} else {
			fetchAfter0();
		}
	};

	setFetchListAfter10002 = (pubkey: string, fetchAfter10002: () => void): void => {
		if (!this.#eventStore.hasReplaceable(10002, pubkey)) {
			this.fetchKind10002([pubkey], fetchAfter10002);
		} else {
			fetchAfter10002();
		}
	};

	subscribeEventStore = (callback: (kind: number, event?: NostrEvent) => void): Subscription => {
		return this.#eventStore.filters({ since: 0 }).subscribe((event: NostrEvent) => {
			switch (event.kind) {
				case 5: {
					this.#eventsDeletion = sortEvents(Array.from(this.#eventStore.getAll([{ kinds: [5] }])));
					break;
				}
				case 7:
				case 17: {
					const fetchAfter10002 = () => {
						if (!this.#eventStore.hasReplaceable(0, event.pubkey)) {
							this.fetchProfile(event.pubkey);
						}
						this.fetchDeletion(event);
					};
					this.setFetchListAfter10002(event.pubkey, fetchAfter10002);
					break;
				}
				case 1111: {
					const fetchAfter10002 = () => {
						if (!this.#eventStore.hasReplaceable(0, event.pubkey)) {
							this.fetchProfile(event.pubkey);
						}
						this.fetchDeletion(event);
						this.fetchReaction(event);
						this.#fetchEventsByATags(event, 'A');
						this.fetchEventsQuoted(event);
					};
					this.setFetchListAfter10002(event.pubkey, fetchAfter10002);
					break;
				}
				case 10030: {
					this.#fetchEventsByATags(event, 'a');
					break;
				}
				case 39701: {
					const fetchAfter10002 = () => {
						if (!this.#eventStore.hasReplaceable(0, event.pubkey)) {
							this.fetchProfile(event.pubkey);
						}
						const d = getTagValue(event, 'd') ?? '';
						const filter = { kinds: [39701], '#d': [d] };
						if (this.#eventStore.getAll(filter).size === 1) {
							this.#rxReqB39701Url.emit(filter); //どこのリレーを指定するべきか…
						}
						this.fetchDeletion(event);
						this.fetchReaction(event);
						this.#fetchWebReaction(`https://${d}`);
						this.#fetchComment(event);
						this.fetchEventsQuoted(event);
					};
					this.setFetchListAfter10002(event.pubkey, fetchAfter10002);
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

	fetchProfile = (pubkey: string, completeCustom?: () => void, relayHints?: string[]) => {
		const filter: LazyFilter = {
			kinds: [0],
			authors: [pubkey],
			until: unixNow()
		};
		const relaySet = new Set<string>(relayHints ?? []);
		const event10002: NostrEvent | undefined = this.getReplaceableEvent(10002, pubkey);
		if (event10002 !== undefined) {
			for (const relayUrl of getInboxes(event10002).filter(this.relayFilter).slice(0, 3)) {
				relaySet.add(relayUrl);
			}
		}
		if (relaySet.size === 0) {
			for (const relayUrl of profileRelays.filter(this.relayFilter)) {
				relaySet.add(relayUrl);
			}
		}
		const relays = Array.from(relaySet);
		const options = relays.length > 0 ? { relays } : undefined;
		if (completeCustom === undefined) {
			this.#rxReqB0.emit(filter, options);
		} else {
			this.#fetchRpCustom(filter, completeCustom, options);
		}
	};

	fetchDeletion = (event: NostrEvent) => {
		const filter: LazyFilter = { kinds: [5], '#e': [event.id], until: unixNow() };
		let options: { relays: string[] } | undefined;
		const event10002: NostrEvent | undefined = this.getReplaceableEvent(10002, event.pubkey);
		if (event10002 !== undefined) {
			const relays = getOutboxes(event10002).filter(this.relayFilter).slice(0, 3);
			options = relays.length > 0 ? { relays } : undefined;
		}
		this.#rxReqB5.emit(filter, options);
	};

	fetchReaction = (event: NostrEvent) => {
		let filter: LazyFilter;
		const until = unixNow();
		if (isReplaceableKind(event.kind) || isAddressableKind(event.kind)) {
			const ap: nip19.AddressPointer = {
				...event,
				identifier: isAddressableKind(event.kind) ? (getTagValue(event, 'd') ?? '') : ''
			};
			filter = {
				kinds: [7],
				'#a': [getCoordinateFromAddressPointer(ap)],
				limit: this.#limitReaction,
				until
			};
		} else {
			filter = { kinds: [7], '#e': [event.id], limit: this.#limitReaction, until };
		}
		let options: { relays: string[] } | undefined;
		const event10002: NostrEvent | undefined = this.getReplaceableEvent(10002, event.pubkey);
		if (event10002 !== undefined) {
			const relays = getInboxes(event10002).filter(this.relayFilter).slice(0, 3);
			options = relays.length > 0 ? { relays } : undefined;
		}
		this.#rxReqB7.emit(filter, options);
	};

	#fetchWebReaction = (url: string) => {
		const filter: LazyFilter = {
			kinds: [17],
			'#r': [url],
			limit: this.#limitReaction,
			until: unixNow()
		};
		const relays = this.#getRelays('write').filter(this.relayFilter).slice(0, 3);
		const options = relays.length > 0 ? { relays } : undefined;
		this.#rxReqB17.emit(filter, options);
	};

	#fetchComment = (event: NostrEvent) => {
		let filter: LazyFilter;
		const until = unixNow();
		if (isReplaceableKind(event.kind) || isAddressableKind(event.kind)) {
			const ap: nip19.AddressPointer = {
				...event,
				identifier: isAddressableKind(event.kind) ? (getTagValue(event, 'd') ?? '') : ''
			};
			filter = {
				kinds: [1111],
				'#A': [getCoordinateFromAddressPointer(ap)],
				limit: this.#limitComment,
				until
			};
		} else {
			filter = { kinds: [1111], '#E': [event.id], limit: this.#limitComment, until };
		}
		let options: { relays: string[] } | undefined;
		const event10002: NostrEvent | undefined = this.getReplaceableEvent(10002, event.pubkey);
		if (event10002 !== undefined) {
			const relays = getInboxes(event10002).filter(this.relayFilter).slice(0, 3);
			options = relays.length > 0 ? { relays } : undefined;
		}
		this.#rxReqB1111.emit(filter, options);
	};

	#getEventsByIdWithRelayHint = (
		event: NostrEvent,
		tagNameToGet: string,
		relaysToExclude: string[],
		onlyLastOne: boolean = false
	) => {
		const until = unixNow();
		if (['e', 'q'].includes(tagNameToGet)) {
			let eTags = event.tags.filter((tag) => tag.length >= 3 && tag[0] === tagNameToGet);
			const eTagLast = eTags.at(-1);
			if (onlyLastOne && eTagLast !== undefined) {
				eTags = [eTagLast];
			}
			for (const eTag of eTags) {
				const id = eTag[1];
				try {
					nip19.neventEncode({ id });
				} catch (_error) {
					continue;
				}
				const relayHint = eTag[2];
				if (
					this.#eventStore.hasEvent(id) ||
					relayHint === undefined ||
					!URL.canParse(relayHint) ||
					!relayHint.startsWith('wss://')
				) {
					continue;
				}
				const relay = normalizeURL(relayHint);
				if (
					relaysToExclude.includes(relay) ||
					this.#deadRelays.includes(relay) ||
					this.#blockedRelays.includes(relay)
				) {
					continue;
				}
				const options: { relays: string[] } = {
					relays: [relay]
				};
				this.#rxReqBIdQ.emit({ ids: [id], until }, options);
			}
		}
		if (['a', 'q'].includes(tagNameToGet)) {
			let aTags = event.tags.filter((tag) => tag.length >= 3 && tag[0] === tagNameToGet);
			const aTagLast = aTags.at(-1);
			if (onlyLastOne && aTagLast !== undefined) {
				aTags = [aTagLast];
			}
			for (const aTag of aTags) {
				let ap: nip19.AddressPointer;
				try {
					ap = getAddressPointerFromATag(aTag);
					nip19.naddrEncode(ap);
				} catch (_error) {
					continue;
				}
				const relayHint = aTag[2];
				if (
					ap === null ||
					this.#eventStore.hasReplaceable(
						ap.kind,
						ap.pubkey,
						isAddressableKind(ap.kind) ? ap.identifier : undefined
					) ||
					relayHint === undefined ||
					!URL.canParse(relayHint) ||
					!relayHint.startsWith('wss://')
				) {
					continue;
				}
				const relay = normalizeURL(relayHint);
				if (
					relaysToExclude.includes(relay) ||
					this.#deadRelays.includes(relay) ||
					this.#blockedRelays.includes(relay)
				) {
					continue;
				}
				const filter: LazyFilter = {
					kinds: [ap.kind],
					authors: [ap.pubkey],
					until
				};
				if (isAddressableKind(ap.kind)) {
					filter['#d'] = [ap.identifier];
				}
				const options: { relays: string[] } = {
					relays: [relay]
				};
				this.#rxReqBAdQ.emit(filter, options);
			}
		}
	};

	fetchEventsQuoted = (event: NostrEvent) => {
		const oId = getIdsForFilter([event]);
		const { ids, aps } = oId;
		for (const id of ids) {
			const event = this.#eventStore.getEvent(id);
			if (event !== undefined) {
				this.#callbackQuote(event);
			}
		}
		for (const ap of aps) {
			const event = this.#eventStore.getReplaceable(ap.kind, ap.pubkey, ap.identifier);
			if (event !== undefined) {
				this.#callbackQuote(event);
			}
		}
		const idsFiltered = ids.filter((id) => !this.#eventStore.hasEvent(id));
		const apsFiltered = aps.filter(
			(ap) =>
				!this.#eventStore.hasReplaceable(
					ap.kind,
					ap.pubkey,
					isAddressableKind(ap.kind) ? ap.identifier : undefined
				)
		);
		const oPk = getPubkeysForFilter([event]);
		const { pubkeys } = oPk;
		const relaySet = new Set<string>(oId.relays);
		for (const pubkey of pubkeys) {
			const event10002: NostrEvent | undefined = this.getReplaceableEvent(10002, pubkey);
			if (event10002 !== undefined) {
				for (const relay of getInboxes(event10002)) {
					relaySet.add(relay);
				}
			}
		}
		const relays = Array.from(relaySet).filter(this.relayFilter);
		const options = relays.length > 0 ? { relays } : undefined;
		const until = unixNow();
		if (idsFiltered.length > 0) {
			this.#rxReqBIdQ.emit({ ids: idsFiltered, until }, options);
		}
		if (apsFiltered.length > 0) {
			for (const ap of apsFiltered) {
				const f: LazyFilter = {
					kinds: [ap.kind],
					authors: [ap.pubkey],
					until
				};
				if (isAddressableKind(ap.kind)) {
					f['#d'] = [ap.identifier];
				}
				this.#rxReqBAdQ.emit(f, options);
			}
		}
		const pubkeysFilterd = pubkeys.filter((pubkey) => !this.#eventStore.hasReplaceable(0, pubkey));
		if (pubkeysFilterd.length > 0) {
			for (const pubkey of pubkeysFilterd) {
				const fetchAfter10002 = () => {
					if (!this.#eventStore.hasReplaceable(0, pubkey)) {
						this.fetchProfile(pubkey, undefined, oPk.relays);
					}
				};
				this.setFetchListAfter10002(pubkey, fetchAfter10002);
			}
		}
		//リレーヒント付き引用による取得
		this.#getEventsByIdWithRelayHint(event, 'q', relays, false);
	};

	fetchKind10002 = (pubkeys: string[], completeCustom: () => void) => {
		const filter: LazyFilter = {
			kinds: [10002],
			authors: pubkeys,
			until: unixNow()
		};
		const relays = indexerRelays.filter(this.relayFilter);
		const options = relays.length > 0 ? { relays } : undefined;
		this.#fetchRpCustom(filter, completeCustom, options);
	};

	fetchUserSettings = (pubkey: string, completeCustom: () => void) => {
		const filter: LazyFilter = {
			kinds: [0, 3, 10000, 10006, 10030],
			authors: [pubkey],
			until: unixNow()
		};
		const relays = this.#getRelays('write').filter(this.relayFilter).slice(0, 3);
		const options = relays.length > 0 ? { relays } : undefined;
		this.#fetchRpCustom(filter, completeCustom, options);
	};

	#fetchRpCustom = (
		filter: LazyFilter,
		completeCustom: () => void,
		options?: Partial<RxNostrUseOptions>
	) => {
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

	fetchWebBookmark = (
		params: UrlParams,
		loginPubkey?: string,
		unitl?: number,
		completeCustom?: () => void
	) => {
		const { currentAddressPointer, currentProfilePointer, currentEventPointer, hashtag, path } =
			params;
		const now = unixNow();
		const filterB: LazyFilter = {
			kinds: [39701],
			until: unitl ?? now,
			limit: unitl === undefined ? 10 : 11
		};
		const relaySet: Set<string> = new Set<string>();
		if (currentAddressPointer !== undefined) {
			filterB.kinds = [currentAddressPointer.kind];
			filterB.authors = [currentAddressPointer.pubkey];
			if (isAddressableKind(currentAddressPointer.kind)) {
				filterB['#d'] = [currentAddressPointer.identifier];
			}
			for (const relay of currentAddressPointer.relays ?? []) {
				relaySet.add(normalizeURL(relay));
			}
		} else if (currentProfilePointer !== undefined) {
			filterB.authors = [currentProfilePointer.pubkey];
			for (const relay of currentProfilePointer.relays ?? []) {
				relaySet.add(normalizeURL(relay));
			}
		} else if (currentEventPointer !== undefined) {
			if (currentEventPointer.kind !== undefined) {
				filterB.kinds = [currentEventPointer.kind];
			} else {
				delete filterB.kinds;
			}
			if (currentEventPointer.author !== undefined) {
				filterB.authors = [currentEventPointer.author];
			}
			filterB.ids = [currentEventPointer.id];
			for (const relay of currentEventPointer.relays ?? []) {
				relaySet.add(normalizeURL(relay));
			}
		} else if (loginPubkey !== undefined) {
			const pubkeys =
				this.getReplaceableEvent(3, loginPubkey)
					?.tags.filter((tag) => tag.length >= 2 && tag[0] === 'p')
					.map((tag) => tag[1]) ?? [];
			if (pubkeys.length > 0) {
				filterB.authors = pubkeys;
			}
		}
		if (hashtag !== undefined) {
			filterB['#t'] = [hashtag];
		}
		if (path !== undefined) {
			filterB['#d'] = [path];
		}
		if (filterB.authors !== undefined) {
			if (filterB.authors.length >= 2) {
				const relays = getReadRelaysWithOutboxModel(
					filterB.authors,
					this.getReplaceableEvent,
					this.relayFilter
				);
				for (const relayUrl of relays) {
					relaySet.add(relayUrl);
				}
			} else {
				for (const pubkey of filterB.authors) {
					const event10002: NostrEvent | undefined = this.getReplaceableEvent(10002, pubkey);
					if (event10002 === undefined) {
						continue;
					}
					for (const relayUrl of getInboxes(event10002)) {
						relaySet.add(relayUrl);
					}
				}
			}
		}
		if (relaySet.size === 0) {
			for (const relay of defaultRelays) {
				relaySet.add(relay);
			}
		}
		const relays = Array.from(relaySet).filter(this.relayFilter);
		const options = relays.length > 0 ? { relays } : undefined;
		if (completeCustom !== undefined) {
			const rxReqBAdCustom = createRxBackwardReq();
			this.#rxNostr
				.use(rxReqBAdCustom)
				.pipe(
					this.#tie,
					latestEach(({ event }) =>
						getCoordinateFromAddressPointer(getAddressPointerForEvent(event))
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
			if (filterB.kinds?.every((kind) => isAddressableKind(kind))) {
				if (currentAddressPointer === undefined) {
					this.#rxReqBAd.emit(filterB, options);
					if (currentProfilePointer !== undefined) {
						this.setFetchListAfter0(currentProfilePointer.pubkey, () => {
							const event = this.getReplaceableEvent(0, currentProfilePointer.pubkey);
							if (event !== undefined) {
								this.fetchEventsQuoted(event);
							}
						});
					}
				} else {
					this.#rxReqBAdQ.emit(filterB, options);
					if (!this.#eventStore.hasReplaceable(0, currentAddressPointer.pubkey)) {
						this.fetchProfile(currentAddressPointer.pubkey);
					}
				}
			} else if (filterB.kinds?.every((kind) => isReplaceableKind(kind))) {
				this.#rxReqBRpQ.emit(filterB, options);
				if (
					currentAddressPointer !== undefined &&
					!this.#eventStore.hasReplaceable(0, currentAddressPointer.pubkey)
				) {
					this.fetchProfile(currentAddressPointer.pubkey);
				}
			} else if (filterB.ids !== undefined) {
				this.#rxReqBIdQ.emit(filterB, options);
				if (
					currentEventPointer?.author !== undefined &&
					!this.#eventStore.hasReplaceable(0, currentEventPointer.author)
				) {
					this.fetchProfile(currentEventPointer.author);
				}
			} else {
				console.warn(filterB);
				throw new TypeError('unexpected filter');
			}
		}
		const filterF: LazyFilter = {
			...filterB
		};
		delete filterF.until;
		delete filterF.limit;
		const since = now + 1;
		filterF.since = since;
		const filtersF: LazyFilter[] = [filterF];
		filtersF.push(
			{
				kinds: [17],
				since
			},
			{
				kinds: [7],
				'#k': ['1111', '39701'],
				since
			}
		);
		if (loginPubkey !== undefined) {
			filtersF.push({
				kinds: [0, 3, 5, 7, 1111, 10000, 10002, 10006, 10030, 39701],
				authors: [loginPubkey],
				since
			});
		}
		this.#rxReqF.emit(filtersF);
	};

	#fetchEventsByATags = (event: NostrEvent, tagName: string) => {
		const aTags = event.tags.filter((tag) => tag.length >= 2 && tag[0] === tagName && !!tag[1]);
		if (aTags.length === 0) {
			return;
		}
		const filters: LazyFilter[] = [];
		const until = unixNow();
		for (const aTag of aTags) {
			let ap: nip19.AddressPointer;
			try {
				ap = getAddressPointerFromATag(aTag);
				nip19.naddrEncode(ap);
			} catch (error) {
				console.warn(error);
				continue;
			}
			if (
				!this.#eventStore.hasReplaceable(
					ap.kind,
					ap.pubkey,
					isAddressableKind(ap.kind) ? ap.identifier : undefined
				)
			) {
				const filter: LazyFilter = {
					kinds: [ap.kind],
					authors: [ap.pubkey],
					until
				};
				if (isAddressableKind(ap.kind)) {
					filter['#d'] = [ap.identifier];
				}
				filters.push(filter);
			}
		}
		const mergedFilters: LazyFilter[] = mergeFilterForAddressableEvents(filters);
		const sliceByNumber = (array: LazyFilter[], number: number) => {
			const length = Math.ceil(array.length / number);
			return new Array(length)
				.fill(undefined)
				.map((_, i) => array.slice(i * number, (i + 1) * number));
		};
		const relayHints: string[] = Array.from(
			new Set<string>(
				event.tags
					.filter((tag) => tag.length >= 3 && tag[0] === tagName && URL.canParse(tag[2]))
					.map((tag) => normalizeURL(tag[2]))
			)
		);
		const relaySet = new Set<string>(relayHints);
		for (const pubkey of new Set<string>(filters.map((f) => f.authors ?? []).flat())) {
			const event10002: NostrEvent | undefined = this.getReplaceableEvent(10002, pubkey);
			if (event10002 !== undefined) {
				for (const relay of getInboxes(event10002)) {
					relaySet.add(relay);
				}
			}
		}
		const relays = Array.from(relaySet).filter(this.relayFilter);
		const options = relays.length > 0 ? { relays } : undefined;
		for (const filters of sliceByNumber(mergedFilters, 10)) {
			this.#rxReqBAd.emit(filters, options);
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
			created_at: unixNow()
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
			created_at: unixNow()
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
			created_at: unixNow()
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
			created_at: unixNow()
		};
		const eventToSend = await window.nostr.signEvent(eventTemplate);
		this.#sendEvent(eventToSend);
	};

	sendComment = async (
		content: string,
		targetEvent: NostrEvent,
		eventsEmojiSet: NostrEvent[],
		contentWarning: string | boolean,
		clientTag: string[] | undefined
	): Promise<void> => {
		if (window.nostr === undefined) {
			return;
		}
		const kind = 1111;
		const tags: string[][] = [];
		const relayHintEvent: string = this.getSeenOn(targetEvent.id, true).at(0) ?? '';
		const relayHintAuthor: string =
			this.getSeenOn(this.getReplaceableEvent(0, targetEvent.pubkey)?.id ?? '', true).at(0) ?? '';
		const pTag = ['p', targetEvent.pubkey, relayHintAuthor];
		if (targetEvent.kind === 1111) {
			const tagsCopied = targetEvent.tags.filter(
				(tag) => tag.length >= 2 && ['A', 'E', 'I', 'K', 'P'].includes(tag[0])
			);
			for (const tag of tagsCopied) {
				tags.push([...tag]);
			}
			tags.push(['e', targetEvent.id, relayHintEvent, targetEvent.pubkey]);
			tags.push(['k', String(targetEvent.kind)]);
		} else if (isReplaceableKind(targetEvent.kind) || isAddressableKind(targetEvent.kind)) {
			const ap: nip19.AddressPointer = {
				...targetEvent,
				identifier: isAddressableKind(targetEvent.kind) ? (getTagValue(targetEvent, 'd') ?? '') : ''
			};
			const a: string = getCoordinateFromAddressPointer(ap);
			tags.push(['A', a, relayHintEvent]);
			tags.push(['K', String(targetEvent.kind)]);
			tags.push(['P', targetEvent.pubkey, relayHintAuthor]);
			tags.push(['a', a, relayHintEvent]);
			tags.push(['e', targetEvent.id, relayHintEvent, targetEvent.pubkey]);
			tags.push(['k', String(targetEvent.kind)]);
		} else {
			tags.push(['E', targetEvent.id, relayHintEvent, targetEvent.pubkey]);
			tags.push(['K', String(targetEvent.kind)]);
			tags.push(['P', targetEvent.pubkey, relayHintAuthor]);
			tags.push(['e', targetEvent.id, relayHintEvent, targetEvent.pubkey]);
			tags.push(['k', String(targetEvent.kind)]);
		}
		for (const tag of getTagsForContent(
			content,
			eventsEmojiSet,
			this.getSeenOn,
			this.getEventsByFilter,
			this.getReplaceableEvent
		).filter((tag) => !(tag[0] === 'p' && tag[1] === targetEvent.pubkey))) {
			tags.push(tag);
		}
		tags.push(pTag);
		if (contentWarning !== false) {
			if (contentWarning === true) {
				tags.push(['content-warning']);
			} else {
				tags.push(['content-warning', contentWarning]);
			}
		}
		if (clientTag !== undefined) {
			tags.push(clientTag);
		}
		const eventTemplate: EventTemplate = {
			kind,
			tags,
			content,
			created_at: unixNow()
		};
		const eventToSend = await window.nostr.signEvent(eventTemplate);
		const relaySet: Set<string> = new Set<string>(this.#getRelays('write'));
		for (const pubkey of tags.filter((tag) => ['p', 'P'].includes(tag[0])).map((tag) => tag[1])) {
			const event10002: NostrEvent | undefined = this.#eventStore.getReplaceable(10002, pubkey);
			if (event10002 !== undefined) {
				for (const relayUrl of getInboxes(event10002)) {
					relaySet.add(relayUrl);
				}
			}
		}
		const relays = Array.from(relaySet);
		const options: Partial<RxNostrSendOptions> | undefined =
			relays.length > 0 ? { on: { relays } } : undefined;
		this.#sendEvent(eventToSend, options);
	};

	sendReaction = async (
		target: NostrEvent | string,
		content: string,
		emojiurl: string | undefined,
		clientTag: string[] | undefined
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
			const relayHintEvent: string = this.getSeenOn(targetEvent.id, true).at(0) ?? '';
			const relayHintAuthor: string =
				this.getSeenOn(this.getReplaceableEvent(0, targetEvent.pubkey)?.id ?? '', true).at(0) ?? '';
			if (isReplaceableKind(targetEvent.kind) || isAddressableKind(targetEvent.kind)) {
				const ap: nip19.AddressPointer = {
					...targetEvent,
					identifier: isAddressableKind(targetEvent.kind)
						? (getTagValue(targetEvent, 'd') ?? '')
						: ''
				};
				const a: string = getCoordinateFromAddressPointer(ap);
				tags.push(['a', a, relayHintEvent]);
			}
			tags.push(
				['e', targetEvent.id, relayHintEvent, targetEvent.pubkey],
				['p', targetEvent.pubkey, relayHintAuthor],
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
		if (clientTag !== undefined) {
			tags.push(clientTag);
		}
		const eventTemplate: EventTemplate = {
			kind,
			tags,
			content,
			created_at: unixNow()
		};
		const eventToSend = await window.nostr.signEvent(eventTemplate);
		if (!isValidEmoji(eventToSend)) {
			console.warn('emoji is invalid');
			return;
		}
		const relaySet: Set<string> = new Set<string>(this.#getRelays('write'));
		if (targetEvent !== undefined) {
			const event10002: NostrEvent | undefined = this.#eventStore.getReplaceable(
				10002,
				targetEvent.pubkey
			);
			if (event10002 !== undefined) {
				for (const relayUrl of getInboxes(event10002)) {
					relaySet.add(relayUrl);
				}
			}
		}
		const relays = Array.from(relaySet);
		const options: Partial<RxNostrSendOptions> | undefined =
			relays.length > 0 ? { on: { relays } } : undefined;
		this.#sendEvent(eventToSend, options);
	};

	sendDeletion = async (targetEvent: NostrEvent): Promise<void> => {
		if (window.nostr === undefined) {
			return;
		}
		if ([5, 62].includes(targetEvent.kind)) {
			throw new TypeError(`cannot delete kind:${targetEvent.kind} event`);
		}
		const tags = [
			['e', targetEvent.id],
			['k', String(targetEvent.kind)]
		];
		const eventTemplate: EventTemplate = {
			kind: 5,
			tags,
			content: '',
			created_at: unixNow()
		};
		const eventToSend = await window.nostr.signEvent(eventTemplate);
		const relaySet: Set<string> = new Set<string>(this.#getRelays('write'));
		const mentionedPubkeys: string[] = targetEvent.tags
			.filter((tag) => tag.length >= 2 && tag[0] === 'p')
			.map((tag) => tag[1]);
		for (const pubkey of mentionedPubkeys) {
			const event10002: NostrEvent | undefined = this.#eventStore.getReplaceable(10002, pubkey);
			if (event10002 === undefined) {
				continue;
			}
			for (const relayUrl of getInboxes(event10002)) {
				relaySet.add(relayUrl);
			}
		}
		const relays = Array.from(relaySet);
		const options: Partial<RxNostrSendOptions> | undefined =
			relays.length > 0 ? { on: { relays } } : undefined;
		this.#sendEvent(eventToSend, options);
	};

	#sendEvent = (eventToSend: NostrEvent, options?: Partial<RxNostrSendOptions>): void => {
		this.#rxNostr.send(eventToSend, options);
	};
}
