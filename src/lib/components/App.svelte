<script lang="ts">
	import { onMount } from 'svelte';
	import { afterNavigate, beforeNavigate } from '$app/navigation';
	import { getRoboHashURL, linkGitHub } from '$lib/config';
	import { RelayConnector, type UrlParams } from '$lib/resource';
	import AddStar from '$lib/components/AddStar.svelte';
	import { now } from 'rx-nostr';
	import type { ProfileContent } from 'applesauce-core/helpers';
	import { nip19 } from 'nostr-tools';
	import type { NostrEvent } from 'nostr-tools/pure';
	import {
		getEventsAddressableLatest,
		getEventsReactionToTheEvent,
		getEventsReactionToTheUrl
	} from '$lib/utils';

	const {
		up
	}: {
		up: UrlParams;
	} = $props();

	let loginPubkey: string | undefined = $state();
	let rc: RelayConnector | undefined = $state();
	let eventsWebBookmark: NostrEvent[] = $state([]);
	let webBookmarkMap: Map<string, NostrEvent[]> = $derived.by(() => {
		if (rc === undefined) {
			return new Map<string, NostrEvent[]>();
		}
		const map = new Map<string, NostrEvent[]>();
		for (const ev of eventsWebBookmark) {
			const d = ev.tags.find((tag) => tag.length >= 2 && tag[0] === 'd')?.at(1) ?? '';
			if (!rc.isValidWebBookmark(d, ev)) {
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
	});
	let eventsProfile: NostrEvent[] = $state([]);
	let profileMap: Map<string, ProfileContent> = $derived(
		new Map<string, ProfileContent>(eventsProfile.map((ev) => [ev.pubkey, JSON.parse(ev.content)]))
	);
	let eventsReaction: NostrEvent[] = $state([]);
	let eventsWebReaction: NostrEvent[] = $state([]);
	let eventsEmojiSet: NostrEvent[] = $state([]);
	let idTimeoutLoading: number;
	let editDTag: string = $state('');
	let editTag: string = $state('');
	let editTags: string[] = $state([]);
	let editTagInput: HTMLInputElement | undefined = $state();
	let editContent: string = $state('');

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
			case 10002: {
				rc.fetchWebBookmark(up, loginPubkey);
				break;
			}
			case 30030: {
				eventsEmojiSet = getEventsAddressableLatest(rc.getEventsByFilter({ kinds: [kind] }));
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

	const callSendWebBookmark = async () => {
		const content: string = editContent;
		const tags: string[][] = [
			['d', editDTag],
			['published_at', getPublishedAt(editDTag) ?? String(now())],
			...editTags.map((t) => ['t', t])
		];
		editDTag = '';
		editTag = '';
		editTags = [];
		editContent = '';
		await rc?.sendWebBookmark(content, tags);
	};

	const getPublishedAt = (d: string): string | undefined => {
		const event = webBookmarkMap.get(`https://${d}`)?.find((ev) => ev.pubkey === loginPubkey);
		return event?.tags.find((tag) => tag.length >= 2 && tag[0] === 'published_at')?.at(1);
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
			if (up) {
				initFetch();
			}
		}, 1000);
		eventsWebBookmark = [];
	});

	const title = 'Nostr Web Bookmark Trend';
</script>

<svelte:head>
	<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/water.css@2/out/dark.css" />
	<title>{title}</title>
</svelte:head>

<header><h1><a href="/">{title}</a></h1></header>
<main>
	<details class="edit">
		<summary>create new web bookmark</summary>
		<dl class="edit">
			<dt class="d-tag">
				<label for="edit-url">URL(d-tag)</label>
			</dt>
			<dd class="d-tag">
				https://<input
					id="edit-url"
					class={editDTag.length === 0 || rc?.isValidWebBookmark(editDTag) ? 'valid' : 'invalid'}
					type="text"
					placeholder="example.com/"
					disabled={loginPubkey === undefined}
					bind:value={editDTag}
				/>
			</dd>
			<dt class="t-tag">
				<label for="edit-category">Category(t-tag)</label>
				{#each editTags as tTag (tTag)}
					<span class="category-tag">#{tTag}</span><button
						type="button"
						disabled={loginPubkey === undefined}
						class="category-delete"
						title="delete the category"
						onclick={() => {
							editTags = editTags.filter((t) => t !== tTag);
						}}>[x]</button
					>
				{/each}
			</dt>
			<dd class="t-tag">
				<input
					id="edit-category"
					type="text"
					placeholder="category"
					disabled={loginPubkey === undefined}
					pattern="[^\s#]+"
					bind:value={editTag}
					bind:this={editTagInput}
				/>
				<button
					type="button"
					disabled={loginPubkey === undefined ||
						editTag.length === 0 ||
						editTagInput.validity.patternMismatch ||
						editTags.map((t) => t.toLowerCase()).includes(editTag.toLowerCase())}
					onclick={() => {
						editTags.push(editTag.toLowerCase());
						editTag = '';
						editTagInput?.focus();
					}}><span>add</span></button
				>
			</dd>
			<dt class="content">
				<label for="edit-comment">Comment(content)</label>
			</dt>
			<dd class="content">
				<textarea
					id="edit-comment"
					placeholder="Write your comment here."
					disabled={loginPubkey === undefined}
					bind:value={editContent}
				></textarea>
			</dd>
			<dt class="submit">Submit</dt>
			<dd class="submit">
				<button
					type="button"
					disabled={loginPubkey === undefined || !rc?.isValidWebBookmark(editDTag)}
					onclick={() => {
						callSendWebBookmark();
					}}>Submit</button
				>
			</dd>
		</dl>
	</details>
	<dl class="url">
		{#each webBookmarkMap as [url, webbookmarks] (url)}
			{@const path = url.replace(/^https?:\/\//, '')}
			{@const n = webbookmarks.length}
			<dt>
				<img
					src={`http://www.google.com/s2/favicons?domain=${encodeURIComponent(url)}`}
					alt="favicon"
					class="favicon"
				/>
				<a href={url} target="_blank" rel="noopener noreferrer">{url}</a>
				<a href="/entry/{path}" class="bookmark-count">{n > 1 ? `${n}users` : `${n}user`}</a>
				<br />
				<AddStar
					{url}
					{rc}
					{loginPubkey}
					{profileMap}
					eventsReactionToTheTarget={getEventsReactionToTheUrl(url, eventsWebReaction)}
					{eventsEmojiSet}
					mutedWords={[]}
				/>
			</dt>
			<dd>
				<dl class="entry">
					{#each webbookmarks as webbookmark (webbookmark.pubkey)}
						{@const identifier =
							webbookmark.tags.find((tag) => tag.length >= 2 && tag[0] === 'd')?.at(1) ?? ''}
						{@const hashtags = new Set<string>(
							webbookmark.tags
								.filter((tag) => tag.length >= 2 && tag[0] === 't')
								.map((tag) => tag[1].toLowerCase())
						)}
						{@const prof = profileMap.get(webbookmark.pubkey)}
						{@const naddr = nip19.naddrEncode({
							kind: webbookmark.kind,
							pubkey: webbookmark.pubkey,
							identifier,
							relays: rc?.getSeenOn(webbookmark.id, true)
						})}
						<dt>
							<button
								type="button"
								disabled={loginPubkey === undefined}
								class="fork"
								onclick={() => {
									editDTag = identifier;
									editTag = '';
									editTags = Array.from(hashtags);
									editContent = '';
									editTagInput?.focus();
								}}>Fork</button
							>
							<a href="/{naddr}">
								<time>{new Date(1000 * webbookmark.created_at).toLocaleString()}</time>
							</a>
							{#if loginPubkey === webbookmark.pubkey}
								<span class="bookmark-delete">
									<button
										class="bookmark-delete"
										title="delete the bookmark"
										onclick={async () => {
											await rc?.sendDeletion(webbookmark);
										}}
										aria-label="delete the bookmark"
									>
										<svg
											xmlns="http://www.w3.org/2000/svg"
											width="16"
											height="16"
											viewBox="0 0 16 16"
										>
											<path
												fill-rule="evenodd"
												d="M8,16 C3.581722,16 0,12.418278 0,8 C0,3.581722 3.581722,0 8,0 C12.418278,0 16,3.581722 16,8 C16,12.418278 12.418278,16 8,16 Z M8,14 C11.3137085,14 14,11.3137085 14,8 C14,4.6862915 11.3137085,2 8,2 C4.6862915,2 2,4.6862915 2,8 C2,11.3137085 4.6862915,14 8,14 Z M8,9.41421356 L5.70710678,11.7071068 L4.29289322,10.2928932 L6.58578644,8 L4.29289322,5.70710678 L5.70710678,4.29289322 L8,6.58578644 L10.2928932,4.29289322 L11.7071068,5.70710678 L9.41421356,8 L11.7071068,10.2928932 L10.2928932,11.7071068 L8,9.41421356 Z"
											/>
										</svg>
									</button>
								</span>
							{/if}
							<AddStar
								event={webbookmark}
								{rc}
								{loginPubkey}
								{profileMap}
								eventsReactionToTheTarget={getEventsReactionToTheEvent(webbookmark, eventsReaction)}
								{eventsEmojiSet}
								mutedWords={[]}
							/>
							<br />
							<a href="/{nip19.npubEncode(webbookmark.pubkey)}">
								<img
									src={prof?.picture ?? getRoboHashURL(webbookmark.pubkey)}
									alt=""
									class="avatar"
								/>@{prof?.name ?? ''}
							</a>
							{#each hashtags as hashtag (hashtag)}
								<a href="/t/{encodeURI(hashtag)}" class="hashtag">#{hashtag}</a>
							{/each}
						</dt>
						<dd>
							{webbookmark.content}
							<details class="details">
								<summary>view JSON</summary>
								<dl class="details">
									<dt>Event JSON</dt>
									<dd>
										<pre class="json-view"><code>{JSON.stringify(webbookmark, undefined, 2)}</code
											></pre>
									</dd>
									<dt>Relays seen on</dt>
									<dd>
										<ul>
											{#each rc?.getSeenOn(webbookmark.id, false) ?? [] as relay (relay)}
												<li>{relay}</li>
											{/each}
										</ul>
									</dd>
								</dl>
							</details>
						</dd>
					{/each}
				</dl>
			</dd>
		{/each}
	</dl>
</main>
<footer><a href={linkGitHub} target="_blank" rel="noopener noreferrer">GitHub</a></footer>

<style>
	summary {
		width: 100%;
	}
	dl.edit input,
	dl.edit textarea {
		min-width: 15em;
	}
	.d-tag {
		line-height: 2.5em;
	}
	.d-tag > input {
		display: inline-block;
	}
	.category-delete,
	.fork {
		padding: 0 3px;
	}
	input#edit-category:invalid,
	input.invalid {
		outline: 2px solid red;
	}
	.bookmark-count {
		display: inline-block;
		color: pink;
		text-shadow: 0 0 2px white;
	}
	.entry > dt {
		position: relative;
	}
	.entry > dd {
		white-space: pre-line;
	}
	.details {
		overflow-x: auto;
	}
	.favicon,
	.avatar {
		width: 16px;
		height: 16px;
	}
	.hashtag {
		margin-left: 0.5em;
	}
	button.bookmark-delete {
		border: none;
		outline: none;
		padding: 0;
		height: 16px;
		cursor: pointer;
		margin: 0;
	}
	button.bookmark-delete > svg {
		width: 16px;
		height: 16px;
		fill: var(--text-bright);
	}
	button.bookmark-delete:active > svg {
		fill: yellow;
	}
	footer {
		text-align: center;
	}
</style>
