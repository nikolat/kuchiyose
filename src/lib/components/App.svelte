<script lang="ts">
	import { onMount } from 'svelte';
	import type { Unsubscriber } from 'svelte/store';
	import { afterNavigate, beforeNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { RelayConnector, type UrlParams } from '$lib/resource';
	import {
		getDeadRelays,
		getRelayConnector,
		getSubscription,
		setDeadRelays,
		setRelayConnector,
		setSubscription
	} from '$lib/resource.svelte';
	import { preferences } from '$lib/store';
	import { sitename } from '$lib/config';
	import {
		getAddressPointerFromATag,
		getProfileContent,
		getTagValue,
		isValidProfile,
		type ProfileContent
	} from 'applesauce-core/helpers';
	import type { Subscription } from 'rxjs';
	import type { ConnectionStatePacket } from 'rx-nostr';
	import { sortEvents, type NostrEvent } from 'nostr-tools/pure';
	import { isAddressableKind } from 'nostr-tools/kinds';
	import type { Filter } from 'nostr-tools/filter';
	import { normalizeURL } from 'nostr-tools/utils';
	import * as nip19 from 'nostr-tools/nip19';
	import {
		getBlockedRelaysList,
		getEventsAddressableLatest,
		getEventsFilteredByMute,
		getMuteList,
		getName,
		getQuotedEvents,
		getTitleFromWebbookmarks,
		getWebBookmarkMap,
		isValidWebBookmark,
		mergeFilterForAddressableEvents
	} from '$lib/utils';
	import Page from '$lib/components/Page.svelte';

	const {
		up
	}: {
		up: UrlParams;
	} = $props();

	let loginPubkey: string | undefined = $state();
	let isAllowedQueryString: boolean = $state(false);
	let isEnabledUseClientTag: boolean = $state(false);
	let isEnabledUseDarkMode: boolean = $state(false);
	let deadRelays: string[] = $derived(getDeadRelays());
	let rc: RelayConnector | undefined = $derived(getRelayConnector());
	let sub: Subscription | undefined = $derived(getSubscription());
	let eventsTimeline: NostrEvent[] = $state([]);
	let eventsWebBookmark: NostrEvent[] = $state([]);
	let eventsProfile: NostrEvent[] = $state([]);
	const profileMap: Map<string, ProfileContent> = $derived(
		new Map<string, ProfileContent>(eventsProfile.map((ev) => [ev.pubkey, getProfileContent(ev)]))
	);
	let eventsReaction: NostrEvent[] = $state([]);
	let eventsWebReaction: NostrEvent[] = $state([]);
	let eventsComment: NostrEvent[] = $state([]);
	let eventFollowList: NostrEvent | undefined = $state();
	const followingPubkeys: string[] = $derived.by(() => {
		const followingPubkeysFromEvent =
			eventFollowList?.tags
				.filter((tag) => tag.length >= 2 && tag[0] === 'p')
				.map((tag) => tag[1]) ?? [];
		const followingPubkeySet = new Set<string>();
		for (const pubkey of followingPubkeysFromEvent) {
			try {
				nip19.npubEncode(pubkey);
			} catch (_error) {
				continue;
			}
			followingPubkeySet.add(pubkey);
		}
		return Array.from(followingPubkeySet);
	});
	let eventMuteList: NostrEvent | undefined = $state();
	let eventBlockedRelaysList: NostrEvent | undefined = $state();
	let mutedPubkeys: string[] = $state([]);
	let mutedIds: string[] = $state([]);
	let mutedWords: string[] = $state([]);
	let mutedHashtags: string[] = $state([]);
	const getMuteListPromise: Promise<[string[], string[], string[], string[]]> = $derived(
		getMuteList(eventMuteList, loginPubkey)
	);
	$effect(() => {
		getMuteListPromise.then((v: [string[], string[], string[], string[]]) => {
			[mutedPubkeys, mutedIds, mutedWords, mutedHashtags] = v;
		});
	});
	let blockedRelays: string[] = $state([]);
	const getBlockedRelaysListPromise: Promise<string[]> = $derived(
		getBlockedRelaysList(eventBlockedRelaysList, loginPubkey)
	);
	$effect(() => {
		getBlockedRelaysListPromise.then((v: string[]) => {
			blockedRelays = v;
			rc?.setBlockedRelays(blockedRelays);
		});
	});
	let eventsEmojiSet: NostrEvent[] = $state([]);
	const getEventsFiltered = (events: NostrEvent[]) => {
		return getEventsFilteredByMute(
			events,
			mutedPubkeys,
			mutedIds,
			mutedWords,
			mutedHashtags
		).filter((ev) => ev.kind !== 39701 || isValidWebBookmark(ev, isAllowedQueryString, false));
	};

	const callback = (kind: number, event?: NostrEvent): void => {
		if (rc === undefined) {
			return;
		}
		switch (kind) {
			case 0: {
				setNewEventsProfile();
				break;
			}
			case 3: {
				if (loginPubkey !== undefined && event?.pubkey === loginPubkey) {
					eventFollowList = rc.getReplaceableEvent(kind, loginPubkey);
				}
				break;
			}
			case 5: {
				if (event !== undefined) {
					const kSet: Set<number> = new Set<number>(
						event.tags
							.filter((tag) => tag.length >= 2 && tag[0] === 'k' && /^\d+$/.test(tag[1]))
							.map((tag) => parseInt(tag[1]))
					);
					for (const k of kSet) {
						callback(k);
					}
				}
				break;
			}
			case 7: {
				setNewEventsReaction();
				break;
			}
			case 17: {
				eventsWebReaction = rc.getEventsByFilter({ kinds: [kind], '#k': ['web'] });
				break;
			}
			case 1111: {
				eventsComment = sortEvents(rc.getEventsByFilter({ kinds: [kind] }));
				break;
			}
			case 10000: {
				if (loginPubkey !== undefined && event?.pubkey === loginPubkey) {
					eventMuteList = rc.getReplaceableEvent(kind, loginPubkey);
				}
				break;
			}
			case 10002: {
				if (loginPubkey !== undefined && event?.pubkey === loginPubkey) {
					rc.setRelays(event);
				}
				break;
			}
			case 10006: {
				if (loginPubkey !== undefined && event?.pubkey === loginPubkey) {
					eventBlockedRelaysList = rc.getReplaceableEvent(kind, loginPubkey);
				}
				break;
			}
			case 10030:
			case 30030: {
				if (loginPubkey !== undefined) {
					const ev10030 = rc.getReplaceableEvent(10030, loginPubkey);
					if (ev10030 !== undefined) {
						const aTags: string[][] = ev10030.tags.filter(
							(tag) => tag.length >= 2 && tag[0] === 'a'
						);
						const aps: nip19.AddressPointer[] = aTags.map((aTag) =>
							getAddressPointerFromATag(aTag)
						);
						const filters: Filter[] = mergeFilterForAddressableEvents(
							aps
								.filter((ap) => isAddressableKind(ap.kind))
								.map((ap) => {
									return { kinds: [ap.kind], authors: [ap.pubkey], '#d': [ap.identifier] };
								})
						);
						eventsEmojiSet = getEventsAddressableLatest(
							rc.getEventsByFilter(filters).concat(ev10030)
						);
					}
				}
				break;
			}
			case 39701: {
				const filter: Filter = {
					kinds: [39701]
				};
				if (up.currentAddressPointer !== undefined) {
					filter.kinds = [up.currentAddressPointer.kind];
					filter.authors = [up.currentAddressPointer.pubkey];
					filter['#d'] = [up.currentAddressPointer.identifier];
				} else if (up.currentProfilePointer !== undefined) {
					filter.authors = [up.currentProfilePointer.pubkey];
				} else if (up.currentEventPointer !== undefined) {
					const ev = rc.getEventsByFilter({ ids: [up.currentEventPointer.id] }).at(0);
					if (ev === undefined) {
						break;
					}
					const ATag: string[] | undefined = ev.tags.find(
						(tag) => tag.length >= 2 && tag[0] === 'A'
					);
					if (ATag === undefined) {
						break;
					}
					let ap: nip19.AddressPointer;
					try {
						ap = getAddressPointerFromATag(ATag);
					} catch (error) {
						console.warn(error);
						break;
					}
					filter.kinds = [ap.kind];
					filter.authors = [ap.pubkey];
					filter['#d'] = [ap.identifier];
				} else if (loginPubkey !== undefined) {
					const pubkeys =
						rc
							.getReplaceableEvent(3, loginPubkey)
							?.tags.filter((tag) => tag.length >= 2 && tag[0] === 'p')
							.map((tag) => tag[1]) ?? [];
					if (pubkeys.length > 0) {
						filter.authors = pubkeys;
					}
				}
				if (up.hashtag !== undefined) {
					filter['#t'] = [up.hashtag];
				}
				if (up.path !== undefined) {
					filter['#d'] = [up.path];
				}
				eventsWebBookmark = getEventsAddressableLatest(rc.getEventsByFilter(filter));
				break;
			}
			default: {
				callback(39701);
				break;
			}
		}
		if (up.currentEventPointer !== undefined && up.currentEventPointer.kind !== 1111) {
			eventsTimeline = rc.getEventsByFilter({ ids: [up.currentEventPointer.id] });
		} else if (up.currentAddressPointer !== undefined && up.currentAddressPointer.kind !== 39701) {
			const ap = up.currentAddressPointer;
			const filter: Filter = { kinds: [ap.kind], authors: [ap.pubkey] };
			if (ap.identifier.length > 0) {
				filter['#d'] = [ap.identifier];
			}
			eventsTimeline = rc.getEventsByFilter(filter);
		} else {
			eventsTimeline = eventsWebBookmark;
		}
	};

	let timerEventsProfile: number | undefined;
	const setNewEventsProfile = () => {
		clearTimeout(timerEventsProfile);
		timerEventsProfile = setTimeout(() => {
			if (rc === undefined) {
				return;
			}
			eventsProfile = getEventsAddressableLatest(rc.getEventsByFilter({ kinds: [0] })).filter(
				(ev) => isValidProfile(ev)
			);
		}, 100);
	};
	let timerEventsReaction: number | undefined;
	const setNewEventsReaction = () => {
		clearTimeout(timerEventsReaction);
		timerEventsReaction = setTimeout(() => {
			if (rc === undefined) {
				return;
			}
			eventsReaction = sortEvents(rc.getEventsByFilter({ kinds: [7] }));
		}, 100);
	};

	const callbackConnectionState = (packet: ConnectionStatePacket) => {
		const relay: string = normalizeURL(packet.from);
		if (['error', 'rejected'].includes(packet.state)) {
			if (!deadRelays.includes(relay)) {
				deadRelays.push(relay);
				rc?.setDeadRelays(deadRelays);
				setDeadRelays(deadRelays);
			}
		} else {
			if (deadRelays.includes(relay)) {
				deadRelays = deadRelays.filter((r) => r !== relay);
				rc?.setDeadRelays(deadRelays);
				setDeadRelays(deadRelays);
			}
		}
	};

	const clearCache = () => {
		eventsTimeline = [];
		eventsWebBookmark = [];
		eventsProfile = [];
		eventsReaction = [];
		eventsWebReaction = [];
		eventsComment = [];
		eventFollowList = undefined;
		eventMuteList = undefined;
		eventBlockedRelaysList = undefined;
		eventsEmojiSet = [];
	};

	const initStatus = () => {
		countToShow = limit;
		isScrolledBottom = false;
		isLoading = false;
		lastUntil = undefined;
	};

	const initFetch = () => {
		sub?.unsubscribe();
		initStatus();
		const pubkeySet = new Set<string>();
		if (rc === undefined) {
			clearCache();
			rc = new RelayConnector(loginPubkey !== undefined, callbackConnectionState);
			setRelayConnector(rc);
			sub = rc.subscribeEventStore(callback);
			setSubscription(sub);
			if (loginPubkey !== undefined) {
				pubkeySet.add(loginPubkey);
			}
		} else {
			sub = rc.subscribeEventStore(callback);
			setSubscription(sub);
			for (const k of [0, 7, 17, 10000, 10006, 10030, 30030, 39701]) {
				callback(k);
			}
		}
		const pubkey: string | undefined =
			up.currentProfilePointer?.pubkey ??
			up.currentAddressPointer?.pubkey ??
			up.currentEventPointer?.author;
		if (pubkey !== undefined) {
			pubkeySet.add(pubkey);
		}
		fetchKind10002AndFollowees(rc, loginPubkey, Array.from(pubkeySet));
	};

	const fetchKind10002AndFollowees = (
		rc: RelayConnector,
		loginPubkey: string | undefined,
		pubkeys: string[]
	) => {
		if (pubkeys.length > 0) {
			rc.fetchKind10002(pubkeys, () => {
				if (loginPubkey !== undefined && rc.getReplaceableEvent(3, loginPubkey) === undefined) {
					rc.fetchUserSettings(loginPubkey, () => {
						const followingPubkeysFromEvent =
							rc
								.getReplaceableEvent(3, loginPubkey)
								?.tags.filter((tag) => tag.length >= 2 && tag[0] === 'p')
								.map((tag) => tag[1]) ?? [];
						const followingPubkeySet = new Set<string>();
						for (const pubkey of followingPubkeysFromEvent) {
							try {
								nip19.npubEncode(pubkey);
							} catch (error) {
								console.info(`pubkey: ${pubkey}`);
								console.warn(error);
								continue;
							}
							followingPubkeySet.add(pubkey);
						}
						const pubkeysSecond: string[] = Array.from(followingPubkeySet);
						if (pubkeysSecond.length > 0) {
							rc.fetchKind10002(pubkeysSecond, () => {
								rc.fetchWebBookmark(up, limit, loginPubkey);
							});
						} else {
							rc.fetchWebBookmark(up, limit, loginPubkey);
						}
					});
				} else {
					rc.fetchWebBookmark(up, limit, loginPubkey);
				}
			});
		} else {
			rc.fetchWebBookmark(up, limit, loginPubkey);
		}
	};

	const saveLocalStorage = () => {
		preferences.set({
			loginPubkey,
			isAllowedQueryString,
			isEnabledUseDarkMode,
			isEnabledUseClientTag
		});
	};

	const nlAuth = (e: Event) => {
		let newLoginPubkey: string | undefined;
		const ce: CustomEvent = e as CustomEvent;
		if (ce.detail.type === 'login' || ce.detail.type === 'signup') {
			newLoginPubkey = ce.detail.pubkey;
		} else {
			newLoginPubkey = undefined;
		}
		if (loginPubkey === newLoginPubkey) {
			return;
		}
		loginPubkey = newLoginPubkey;
		saveLocalStorage();
		rc?.dispose();
		rc = undefined;
		setRelayConnector(rc);
		initFetch();
	};

	const limit: number = 10;
	let countToShow: number = $state(limit);
	let countToShowMax: number = limit;
	const scopeCountToShow: number = 3 * limit;
	const timelineSliced: NostrEvent[] = $derived(
		eventsTimeline.slice(
			countToShow - scopeCountToShow > 0 ? countToShow - scopeCountToShow : 0,
			countToShow
		)
	);
	const isFullDisplayMode: boolean = $derived(
		up.currentAddressPointer !== undefined || up.path !== undefined
	);
	const scrollThreshold: number = 500;
	let isScrolledTop: boolean = false;
	let isScrolledBottom: boolean = false;
	let isLoading: boolean = false;
	let lastUntil: number | undefined = undefined;
	const completeCustom = (): void => {
		console.info('[Loading Complete]');
		const correctionCount = Math.max(
			1,
			timelineSliced.filter((ev) => ev.created_at === lastUntil).length
		);
		countToShow += limit + 1 - correctionCount; //unitlと同時刻のイベントは被って取得されるので補正
		countToShowMax = Math.max(countToShowMax, countToShow);
		isLoading = false;
	};

	const handlerScroll = (): void => {
		if (rc === undefined || isFullDisplayMode) {
			return;
		}
		const scrollHeight = Math.max(
			document.body.scrollHeight,
			document.documentElement.scrollHeight,
			document.body.offsetHeight,
			document.documentElement.offsetHeight,
			document.body.clientHeight,
			document.documentElement.clientHeight
		);
		const pageMostBottom = scrollHeight - window.innerHeight;
		const pageMostTop = 0;
		const scrollTop = window.scrollY || document.documentElement.scrollTop;
		if (scrollTop > pageMostBottom - scrollThreshold) {
			if (!isScrolledBottom && !isLoading) {
				isScrolledBottom = true;
				isLoading = true;
				//取得済のイベントは再取得しない
				if (countToShow + limit <= countToShowMax) {
					console.info('[Loading Start(not fetching)]');
					completeCustom();
					return;
				}
				const lastUntilNext: number | undefined = timelineSliced.at(-1)?.created_at;
				if (lastUntilNext === undefined || lastUntil === lastUntilNext) {
					return;
				}
				lastUntil = lastUntilNext;
				console.info('[Loading Start]');
				rc.fetchWebBookmark(up, limit, loginPubkey, lastUntil, completeCustom);
			}
		} else if (isScrolledBottom && scrollTop < pageMostBottom - scrollThreshold) {
			isScrolledBottom = false;
		}
		if (scrollTop < pageMostTop + scrollThreshold && countToShow > scopeCountToShow) {
			if (!isScrolledTop && !isLoading) {
				isScrolledTop = true;
				if (countToShow > scopeCountToShow) {
					countToShow = Math.max(countToShow - limit, scopeCountToShow);
				}
			}
		} else if (isScrolledTop && scrollTop > pageMostTop + scrollThreshold) {
			isScrolledTop = false;
		}
	};

	let unsubscriber: Unsubscriber | undefined;
	onMount(async () => {
		if (up.isError) {
			return;
		}
		if (document.querySelector('body > nl-banner') === null) {
			const { init } = await import('nostr-login');
			init({});
		}
	});
	beforeNavigate(() => {
		if (unsubscriber !== undefined) {
			unsubscriber();
		}
		if (up.isError) {
			return;
		}
		document.removeEventListener('nlAuth', nlAuth);
		document.removeEventListener('scroll', handlerScroll);
	});
	afterNavigate(() => {
		unsubscriber = preferences.subscribe(
			(value: {
				loginPubkey: string | undefined;
				isAllowedQueryString: boolean;
				isEnabledUseDarkMode: boolean;
				isEnabledUseClientTag: boolean;
			}) => {
				loginPubkey = value.loginPubkey;
				isAllowedQueryString = value.isAllowedQueryString;
				isEnabledUseDarkMode = value.isEnabledUseDarkMode;
				isEnabledUseClientTag = value.isEnabledUseClientTag;
			}
		);
		if (up.isError) {
			return;
		}
		document.addEventListener('nlAuth', nlAuth);
		document.addEventListener('scroll', handlerScroll);
		setTimeout(() => {
			initFetch();
		}, 10);
	});

	const title = $derived.by(() => {
		let title: string | undefined;
		if (up.currentAddressPointer !== undefined) {
			const ap = up.currentAddressPointer;
			const event = rc?.getReplaceableEvent(ap.kind, ap.pubkey, ap.identifier);
			if (event !== undefined) {
				title = getTagValue(event, 'title');
			}
		} else if (up.currentProfilePointer !== undefined) {
			const profile: ProfileContent | undefined = profileMap.get(up.currentProfilePointer.pubkey);
			if (profile !== undefined) {
				const name = getName(up.currentProfilePointer.pubkey, profileMap, eventFollowList);
				title = `${name}'s bookmarks`;
			}
		} else if (up.hashtag !== undefined) {
			title = `#${up.hashtag}`;
		} else if (up.path !== undefined) {
			const webbookmarks = getWebBookmarkMap(eventsWebBookmark).get(`https://${up.path}`);
			if (webbookmarks !== undefined) {
				title = getTitleFromWebbookmarks(webbookmarks);
			}
		}
		if (title === undefined) {
			return sitename;
		}
		return `${title} | ${sitename}`;
	});

	const getAllBookmarksEachUrl = (events: NostrEvent[], hashtag?: string): NostrEvent[] => {
		if (rc === undefined) {
			return [];
		}
		const dSet = new Set<string>(
			events.map((ev) => getTagValue(ev, 'd')).filter((ev) => ev !== undefined)
		);
		const filter: Filter = { kinds: [39701], '#d': Array.from(dSet) };
		if (hashtag !== undefined) {
			filter['#t'] = [hashtag];
		}
		return rc.getEventsByFilter(filter);
	};
	const isRoot: boolean = $derived(Object.values(up).every((v) => v === undefined));
	const filteredTimeline = $derived(getEventsFiltered(timelineSliced));
	const eventsTimelineToShow: NostrEvent[] = $derived(
		isRoot
			? getAllBookmarksEachUrl(filteredTimeline)
			: up.hashtag !== undefined
				? getAllBookmarksEachUrl(filteredTimeline, up.hashtag)
				: filteredTimeline
	);
	const eventsQuoted: NostrEvent[] = $derived(
		rc === undefined ? [] : getQuotedEvents(rc, eventsTimelineToShow, 5)
	);
	const cssUrl: string = $derived(
		`https://cdn.jsdelivr.net/npm/water.css@2/out/${isEnabledUseDarkMode ? 'dark' : 'light'}.css`
	);
</script>

<svelte:head>
	<meta property="og:title" content={sitename} />
	<meta property="og:type" content="website" />
	<meta property="og:image" content={`${page.url.origin}/ogp.png`} />
	<meta property="og:url" content={page.url.href} />
	<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
	<link rel="icon" type="image/png" sizes="16x16" href="/favicon.png" />
	<link rel="manifest" href="/manifest.json" />
	<link rel="stylesheet" href={cssUrl} />
	<title>{title}</title>
</svelte:head>

<Page
	{up}
	{rc}
	{loginPubkey}
	bind:isAllowedQueryString
	bind:isEnabledUseDarkMode
	bind:isEnabledUseClientTag
	{saveLocalStorage}
	{profileMap}
	{eventsProfile}
	eventsTimeline={eventsTimelineToShow}
	eventsReaction={getEventsFiltered(eventsReaction)}
	eventsWebReaction={getEventsFiltered(eventsWebReaction)}
	eventsComment={getEventsFiltered(eventsComment)}
	{eventsEmojiSet}
	eventsQuoted={getEventsFiltered(eventsQuoted)}
	{eventFollowList}
	isFollowingPubkeyPage={followingPubkeys.includes(up.currentProfilePointer?.pubkey ?? '')}
	isMutedPubkeyPage={mutedPubkeys.includes(up.currentProfilePointer?.pubkey ?? '')}
	isMutedHashtagPage={mutedHashtags.includes(up.hashtag ?? '')}
/>
