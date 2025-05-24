<script lang="ts">
	import { onMount } from 'svelte';
	import { afterNavigate, beforeNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { RelayConnector, type UrlParams } from '$lib/resource';
	import { getRelayConnector, setRelayConnector } from '$lib/resource.svelte';
	import { preferences } from '$lib/store';
	import { sitename } from '$lib/config';
	import {
		getAddressPointerFromATag,
		getProfileContent,
		getTagValue,
		unixNow,
		type ProfileContent
	} from 'applesauce-core/helpers';
	import type { Subscription } from 'rxjs';
	import { sortEvents, type NostrEvent } from 'nostr-tools/pure';
	import type { Filter } from 'nostr-tools/filter';
	import * as nip19 from 'nostr-tools/nip19';
	import {
		getEventsAddressableLatest,
		getEventsFilteredByMute,
		getMuteList,
		getTitleFromWebbookmarks,
		getWebBookmarkMap
	} from '$lib/utils';
	import Page from '$lib/components/Page.svelte';

	const {
		up
	}: {
		up: UrlParams;
	} = $props();

	let loginPubkey: string | undefined = $state();
	let rc: RelayConnector | undefined = $derived(getRelayConnector());
	let sub: Subscription | undefined;
	let eventsWebBookmark: NostrEvent[] = $state([]);
	let eventsProfile: NostrEvent[] = $state([]);
	const profileMap: Map<string, ProfileContent> = $derived(
		new Map<string, ProfileContent>(eventsProfile.map((ev) => [ev.pubkey, getProfileContent(ev)]))
	);
	let eventsReaction: NostrEvent[] = $state([]);
	let eventsWebReaction: NostrEvent[] = $state([]);
	let eventsComment: NostrEvent[] = $state([]);
	let eventMuteList: NostrEvent | undefined = $state();
	let [mutedPubkeys, mutedIds, mutedWords, mutedHashtags]: [
		string[],
		string[],
		string[],
		string[]
	] = $state([[], [], [], []]);
	const getMuteListPromise: Promise<[string[], string[], string[], string[]]> = $derived(
		getMuteList(eventMuteList, loginPubkey)
	);
	$effect(() => {
		getMuteListPromise.then((v: [string[], string[], string[], string[]]) => {
			[mutedPubkeys, mutedIds, mutedWords, mutedHashtags] = v;
		});
	});
	let eventsEmojiSet: NostrEvent[] = $state([]);
	const getEventsFiltered = (events: NostrEvent[]) => {
		return getEventsFilteredByMute(events, mutedPubkeys, mutedIds, mutedWords, mutedHashtags);
	};

	const callback = (kind: number, event?: NostrEvent) => {
		if (rc === undefined) {
			return;
		}
		switch (kind) {
			case 0: {
				eventsProfile = getEventsAddressableLatest(rc.getEventsByFilter({ kinds: [kind] }));
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
				eventsReaction = rc.getEventsByFilter({ kinds: [kind] });
				break;
			}
			case 17: {
				eventsWebReaction = rc.getEventsByFilter({ kinds: [kind] });
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
			case 10030:
			case 30030: {
				if (loginPubkey !== undefined) {
					eventsEmojiSet = getEventsAddressableLatest(
						rc.getEventsByFilter([{ kinds: [10030], authors: [loginPubkey] }, { kinds: [30030] }])
					);
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
			default:
				break;
		}
	};

	const clearCache = () => {
		eventsWebBookmark = [];
		eventsProfile = [];
		eventsReaction = [];
		eventsWebReaction = [];
		eventsComment = [];
		eventMuteList = undefined;
		eventsEmojiSet = [];
	};

	const initStatus = () => {
		countToShow = 10;
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
			rc = new RelayConnector(loginPubkey !== undefined);
			setRelayConnector(rc);
			sub = rc.subscribeEventStore(callback);
			if (loginPubkey !== undefined) {
				pubkeySet.add(loginPubkey);
			}
		} else {
			sub = rc.subscribeEventStore(callback);
			for (const k of [0, 7, 17, 10000, 10030, 30030, 39701]) {
				callback(k);
			}
			rc.setRelays();
		}
		const pubkey: string | undefined =
			up.currentProfilePointer?.pubkey ??
			up.currentAddressPointer?.pubkey ??
			up.currentEventPointer?.author;
		if (pubkey !== undefined) {
			pubkeySet.add(pubkey);
		}
		if (pubkeySet.size > 0) {
			rc.fetchKind10002(Array.from(pubkeySet), () => {
				if (rc === undefined) {
					return;
				}
				if (loginPubkey !== undefined) {
					rc.fetchUserSettings(loginPubkey);
				}
				rc.fetchWebBookmark(up, loginPubkey);
			});
		} else {
			rc.fetchWebBookmark(up, loginPubkey);
		}
	};

	preferences.subscribe((value: { loginPubkey: string | undefined }) => {
		loginPubkey = value.loginPubkey;
	});
	const saveLocalStorage = () => {
		preferences.set({
			loginPubkey
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

	let countToShow: number = $state(10);
	const timelineSliced = $derived(eventsWebBookmark.slice(0, countToShow));
	const isFullDisplayMode: boolean = $derived(
		up.currentAddressPointer !== undefined || up.path !== undefined
	);
	const scrollThreshold: number = 300;
	let isScrolledBottom: boolean = false;
	let isLoading: boolean = false;
	let lastUntil: number | undefined = undefined;
	const completeCustom = (): void => {
		console.info('[Loading Complete]');
		const correctionCount = timelineSliced.filter((ev) => ev.created_at === lastUntil).length;
		countToShow += 11 - correctionCount; //unitlと同時刻のイベントは被って取得されるので補正
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
		const scrollTop = window.scrollY || document.documentElement.scrollTop;
		if (scrollTop > pageMostBottom - scrollThreshold) {
			if (!isScrolledBottom && !isLoading) {
				isScrolledBottom = true;
				isLoading = true;
				const lastUntilNext = timelineSliced.at(-1)?.created_at ?? unixNow();
				if (lastUntil === lastUntilNext) {
					return;
				}
				lastUntil = lastUntilNext;
				console.info('[Loading Start]');
				rc.fetchWebBookmark(up, loginPubkey, lastUntil, completeCustom);
			}
		} else if (isScrolledBottom && scrollTop < pageMostBottom + scrollThreshold) {
			isScrolledBottom = false;
		}
	};

	onMount(async () => {
		if (up.isError) {
			return;
		}
		const { init } = await import('nostr-login');
		init({});
	});
	beforeNavigate(() => {
		if (up.isError) {
			return;
		}
		document.removeEventListener('nlAuth', nlAuth);
		document.removeEventListener('scroll', handlerScroll);
	});
	afterNavigate(() => {
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
				title = `${profile.name}'s bookmarks`;
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
	const eventsWebBookmarkToShow = $derived(
		isRoot
			? getAllBookmarksEachUrl(filteredTimeline)
			: up.hashtag !== undefined
				? getAllBookmarksEachUrl(filteredTimeline, up.hashtag)
				: filteredTimeline
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
	<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/water.css@2/out/dark.css" />
	<title>{title}</title>
</svelte:head>

<Page
	{up}
	{rc}
	{loginPubkey}
	{profileMap}
	eventsWebBookmark={eventsWebBookmarkToShow}
	eventsReaction={getEventsFiltered(eventsReaction)}
	eventsWebReaction={getEventsFiltered(eventsWebReaction)}
	eventsComment={getEventsFiltered(eventsComment)}
	{eventsEmojiSet}
	isMutedPubkeyPage={mutedPubkeys.includes(up.currentProfilePointer?.pubkey ?? '')}
	isMutedHashtagPage={mutedHashtags.includes(up.hashtag ?? '')}
/>
