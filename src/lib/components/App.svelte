<script lang="ts">
	import { onMount } from 'svelte';
	import { afterNavigate, beforeNavigate } from '$app/navigation';
	import { RelayConnector, type UrlParams } from '$lib/resource';
	import { sitename } from '$lib/config';
	import type { ProfileContent } from 'applesauce-core/helpers';
	import type { NostrEvent } from 'nostr-tools/pure';
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
	let rc: RelayConnector | undefined = $state();
	let eventsWebBookmark: NostrEvent[] = $state([]);
	let eventsProfile: NostrEvent[] = $state([]);
	let profileMap: Map<string, ProfileContent> = $derived(
		new Map<string, ProfileContent>(eventsProfile.map((ev) => [ev.pubkey, JSON.parse(ev.content)]))
	);
	let eventsReaction: NostrEvent[] = $state([]);
	let eventsWebReaction: NostrEvent[] = $state([]);
	let eventMuteList: NostrEvent | undefined = $state();
	let [mutedPubkeys, mutedIds, mutedWords, mutedHashTags]: [
		string[],
		string[],
		string[],
		string[]
	] = $state([[], [], [], []]);
	let getMuteListPromise: Promise<[string[], string[], string[], string[]]> = $derived(
		getMuteList(eventMuteList, loginPubkey)
	);
	$effect(() => {
		getMuteListPromise.then((v: [string[], string[], string[], string[]]) => {
			[mutedPubkeys, mutedIds, mutedWords, mutedHashTags] = v;
		});
	});
	const getEventsFiltered = (events: NostrEvent[]) => {
		return getEventsFilteredByMute(events, mutedPubkeys, mutedIds, mutedWords, mutedHashTags);
	};
	let webBookmarkMap: Map<string, NostrEvent[]> = $derived(
		getWebBookmarkMap(getEventsFiltered(eventsWebBookmark))
	);
	let eventsEmojiSet: NostrEvent[] = $state([]);
	let idTimeoutLoading: number;

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
			case 10000: {
				if (loginPubkey !== undefined && event?.pubkey === loginPubkey) {
					eventMuteList = rc.getReplaceableEvent(kind, loginPubkey);
				}
				break;
			}
			case 10002: {
				if (loginPubkey !== undefined && event?.pubkey === loginPubkey) {
					rc.fetchUserSettings(loginPubkey);
					rc.fetchWebBookmark(up, loginPubkey);
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
				eventsWebBookmark = getEventsAddressableLatest(rc.getEventsByFilter({ kinds: [kind] }));
				break;
			}
			default:
				break;
		}
	};

	const initFetch = () => {
		eventsWebBookmark = [];
		eventsProfile = [];
		eventsReaction = [];
		eventsWebReaction = [];
		eventMuteList = undefined;
		eventsEmojiSet = [];
		rc?.dispose();
		rc = new RelayConnector(loginPubkey !== undefined);
		rc.subscribeEventStore(callback);
		if (loginPubkey !== undefined) {
			rc.fetchUserInfo(loginPubkey);
		} else {
			rc.fetchWebBookmark(up);
		}
	};

	const nlAuth = (e: Event) => {
		clearTimeout(idTimeoutLoading);
		const ce: CustomEvent = e as CustomEvent;
		if (ce.detail.type === 'login' || ce.detail.type === 'signup') {
			loginPubkey = ce.detail.pubkey;
		} else {
			loginPubkey = undefined;
		}
		initFetch();
	};

	onMount(async () => {
		const { init } = await import('nostr-login');
		init({});
	});
	beforeNavigate(() => {
		document.removeEventListener('nlAuth', nlAuth);
		rc?.dispose();
	});
	afterNavigate(() => {
		document.addEventListener('nlAuth', nlAuth);
		idTimeoutLoading = setTimeout(() => {
			initFetch();
		}, 1000);
		eventsWebBookmark = [];
	});

	const title = $derived.by(() => {
		let title: string | undefined;
		if (up.currentAddressPointer !== undefined) {
			const ap = up.currentAddressPointer;
			const event = rc?.getReplaceableEvent(ap.kind, ap.pubkey, ap.identifier);
			title = event?.tags.find((tag) => tag.length >= 2 && tag[0] === 'title')?.at(1);
		} else if (up.currentProfilePointer !== undefined) {
			const profile: ProfileContent | undefined = profileMap.get(up.currentProfilePointer.pubkey);
			if (profile !== undefined) {
				title = `${profile.name}'s bookmarks`;
			}
		} else if (up.hashtag !== undefined) {
			title = `#${up.hashtag}`;
		} else if (up.path !== undefined) {
			const webbookmarks = webBookmarkMap.get(`https://${up.path}`);
			if (webbookmarks !== undefined) {
				title = getTitleFromWebbookmarks(webbookmarks);
			}
		}
		if (title === undefined) {
			return sitename;
		}
		return `${title} | ${sitename}`;
	});
</script>

<svelte:head>
	<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/water.css@2/out/dark.css" />
	<title>{title}</title>
</svelte:head>

<Page
	{rc}
	{loginPubkey}
	{profileMap}
	eventsWebBookmark={getEventsFiltered(eventsWebBookmark)}
	{webBookmarkMap}
	eventsReaction={getEventsFiltered(eventsReaction)}
	eventsWebReaction={getEventsFiltered(eventsWebReaction)}
	{eventsEmojiSet}
/>
