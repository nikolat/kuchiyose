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
	let webBookmarkArray: { url: string; webbookmarks: NostrEvent[] }[] = $state([]);
	let webBookmarkMap: Map<string, NostrEvent[]> = $derived.by(() => {
		const map = new Map<string, NostrEvent[]>();
		for (const { url, webbookmarks } of webBookmarkArray) {
			map.set(url, webbookmarks);
		}
		return map;
	});
	let profileArray: { pubkey: string; profile: ProfileContent }[] = $state([]);
	let profileMap: Map<string, ProfileContent> = $derived.by(() => {
		const map = new Map<string, ProfileContent>();
		for (const { pubkey, profile } of profileArray) {
			map.set(pubkey, profile);
		}
		return map;
	});
	let eventsReaction: NostrEvent[] = $state([]);
	let eventsWebReaction: NostrEvent[] = $state([]);
	let eventsEmojiSet: NostrEvent[] = $state([]);
	let idTimeoutLoading: number;
	let editDTag: string = $state('');
	let editTag: string = $state('');
	let editTags: string[] = $state([]);
	let editTagInput: HTMLInputElement | undefined = $state();
	let editContent: string = $state('');

	const callbackRelayRecord = () => {
		rc?.fetchWebBookmark(up);
	};

	const callbackEmojiSet = (event: NostrEvent) => {
		eventsEmojiSet.push(event);
		eventsEmojiSet = getEventsAddressableLatest(eventsEmojiSet);
	};

	const callbackReaction = (event: NostrEvent) => {
		eventsReaction.push(event);
	};

	const callbackWebReaction = (event: NostrEvent) => {
		eventsWebReaction.push(event);
	};

	const initFetch = () => {
		webBookmarkArray = [];
		eventsReaction = [];
		eventsWebReaction = [];
		eventsEmojiSet = [];
		rc?.dispose();
		rc = new RelayConnector(loginPubkey !== undefined);
		rc.subscribeEventStore(
			webBookmarkArray,
			profileArray,
			callbackRelayRecord,
			callbackEmojiSet,
			callbackReaction,
			callbackWebReaction
		);
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
		webBookmarkArray = [];
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
		{#each webBookmarkArray as { url, webbookmarks } (url)}
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
	footer {
		text-align: center;
	}
</style>
