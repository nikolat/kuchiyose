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
		getEventsReactionToTheTarget,
		getTitleFromWebbookmarks,
		getWebBookmarkMap,
		isValidWebBookmark
	} from '$lib/utils';

	const {
		up
	}: {
		up: UrlParams;
	} = $props();

	let isDevMode: boolean = $state(false);
	let loginPubkey: string | undefined = $state();
	let rc: RelayConnector | undefined = $state();
	let eventsWebBookmark: NostrEvent[] = $state([]);
	let webBookmarkMap: Map<string, NostrEvent[]> = $derived(getWebBookmarkMap(eventsWebBookmark));
	let eventsProfile: NostrEvent[] = $state([]);
	let profileMap: Map<string, ProfileContent> = $derived(
		new Map<string, ProfileContent>(eventsProfile.map((ev) => [ev.pubkey, JSON.parse(ev.content)]))
	);
	let eventsReaction: NostrEvent[] = $state([]);
	let eventsWebReaction: NostrEvent[] = $state([]);
	let eventsEmojiSet: NostrEvent[] = $state([]);
	let idTimeoutLoading: number;
	let isOpenEdit: boolean = $state(false);
	let editDTag: string = $state('');
	let editTitleTag: string = $state('');
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
				if (loginPubkey !== undefined && event?.pubkey === loginPubkey) {
					rc.fetchEmojiSet(loginPubkey);
					rc.fetchWebBookmark(up, loginPubkey);
				}
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

	const sendWebBookmark = async () => {
		const kind: number = 39701;
		const content: string = editContent;
		const created_at: number = now();
		const tags: string[][] = [
			['d', editDTag],
			['published_at', getPublishedAt(editDTag) ?? String(created_at)],
			...editTags.map((t) => ['t', t])
		];
		if (editTitleTag.length > 0) {
			tags.push(['title', editTitleTag]);
		}
		editDTag = '';
		editTitleTag = '';
		editTag = '';
		editTags = [];
		editContent = '';
		await rc?.signAndSendEvent({ kind, tags, content, created_at });
	};
	const getPublishedAt = (d: string): string | undefined => {
		const event = webBookmarkMap.get(`https://${d}`)?.find((ev) => ev.pubkey === loginPubkey);
		return event?.tags.find((tag) => tag.length >= 2 && tag[0] === 'published_at')?.at(1);
	};

	const getSendReaction = (target: NostrEvent | string) => {
		return async (content?: string, emojiurl?: string) => {
			await rc?.sendReaction(target, content, emojiurl);
		};
	};
	const sendDeletion = async (targetEvent: NostrEvent) => await rc?.sendDeletion(targetEvent);

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

<header>
	<h1><a href="/">{title}</a></h1>
	<span class="setting">
		<input type="checkbox" id="dev-mode" name="mode" bind:checked={isDevMode} />
		<label for="dev-mode">Dev Mode</label>
		{#if loginPubkey !== undefined}
			<a href="/{nip19.npubEncode(loginPubkey)}">
				<img
					src={profileMap.get(loginPubkey)?.picture ?? getRoboHashURL(loginPubkey)}
					alt="your avatar"
					class="login-user"
				/>
			</a>
		{/if}
	</span>
</header>
<main>
	<details class="edit" bind:open={isOpenEdit}>
		<summary>create new web bookmark</summary>
		<dl class="edit">
			<dt class="d-tag">
				<label for="edit-url">URL(d-tag)</label>
			</dt>
			<dd class="d-tag">
				https://<input
					id="edit-url"
					class={editDTag.length === 0 || isValidWebBookmark(editDTag) ? 'valid' : 'invalid'}
					type="text"
					placeholder="example.com/"
					disabled={loginPubkey === undefined}
					bind:value={editDTag}
					onpaste={(e: ClipboardEvent & { currentTarget: EventTarget & HTMLInputElement }) => {
						const pastedText = e.clipboardData?.getData('text/plain');
						if (pastedText?.startsWith('https://')) {
							e.preventDefault();
							editDTag = pastedText.replace(/^https:\/\//, '');
						}
					}}
				/>
			</dd>
			<dt class="title-tag">
				<label for="edit-title">Title(title-tag)</label>
			</dt>
			<dd class="title-tag">
				<input
					id="edit-title"
					type="text"
					placeholder="title(optional)"
					disabled={loginPubkey === undefined}
					bind:value={editTitleTag}
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
						}}
						aria-label="delete the category"
					>
						<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
							<path
								fill-rule="evenodd"
								d="M12,23 C5.92486775,23 1,18.0751322 1,12 C1,5.92486775 5.92486775,1 12,1 C18.0751322,1 23,5.92486775 23,12 C23,18.0751322 18.0751322,23 12,23 Z M12,21 C16.9705627,21 21,16.9705627 21,12 C21,7.02943725 16.9705627,3 12,3 C7.02943725,3 3,7.02943725 3,12 C3,16.9705627 7.02943725,21 12,21 Z M12,13.4142136 L8.70710678,16.7071068 L7.29289322,15.2928932 L10.5857864,12 L7.29289322,8.70710678 L8.70710678,7.29289322 L12,10.5857864 L15.2928932,7.29289322 L16.7071068,8.70710678 L13.4142136,12 L16.7071068,15.2928932 L15.2928932,16.7071068 L12,13.4142136 Z"
							/>
						</svg>
					</button>
				{/each}
			</dt>
			<dd class="t-tag">
				<input
					id="edit-category"
					type="text"
					placeholder="category(optional)"
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
					disabled={loginPubkey === undefined || !isValidWebBookmark(editDTag)}
					onclick={sendWebBookmark}>Submit</button
				>
			</dd>
		</dl>
	</details>
	<dl class="url">
		{#each webBookmarkMap as [url, webbookmarks] (url)}
			{@const path = url.replace(/^https?:\/\//, '')}
			{@const title = getTitleFromWebbookmarks(webbookmarks)}
			{@const n = webbookmarks.length}
			<dt>
				<img
					src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(url)}`}
					alt="favicon"
					class="favicon"
				/>
				<a href={url} target="_blank" rel="noopener noreferrer">{title ?? url}</a>
				<br />
				<span class="url">{url}</span>
				<br />
				<a href="/entry/{path}" class="bookmark-count">{n > 1 ? `${n}users` : `${n}user`}</a>
				<AddStar
					sendReaction={getSendReaction(url)}
					{sendDeletion}
					{loginPubkey}
					{profileMap}
					eventsReactionToTheTarget={getEventsReactionToTheTarget(url, eventsWebReaction)}
					{eventsEmojiSet}
					mutedWords={[]}
				/>
			</dt>
			<dd>
				<dl class="entry">
					{#each webbookmarks as webbookmark (webbookmark.pubkey)}
						{@const identifier =
							webbookmark.tags.find((tag) => tag.length >= 2 && tag[0] === 'd')?.at(1) ?? ''}
						{@const title =
							webbookmark.tags.find((tag) => tag.length >= 2 && tag[0] === 'title')?.at(1) ?? ''}
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
							{#if loginPubkey !== undefined}
								<button
									type="button"
									class="fork"
									onclick={() => {
										editDTag = identifier;
										editTitleTag = title;
										editTag = '';
										editTags = Array.from(hashtags);
										editContent = webbookmark.content;
										isOpenEdit = true;
										setTimeout(() => {
											editTagInput?.focus();
										}, 10);
									}}>Fork</button
								>
							{/if}
							<a href="/{naddr}">
								<time>{new Date(1000 * webbookmark.created_at).toLocaleString()}</time>
							</a>
							{#if loginPubkey === webbookmark.pubkey}
								<span class="bookmark-delete">
									<button
										class="bookmark-delete"
										title="delete the bookmark"
										onclick={async () => {
											await sendDeletion(webbookmark);
										}}
										aria-label="delete the bookmark"
									>
										<svg
											xmlns="http://www.w3.org/2000/svg"
											width="24"
											height="24"
											viewBox="0 0 24 24"
										>
											<path
												fill-rule="evenodd"
												d="M7,4 L7,3 C7,1.8954305 7.8954305,1 9,1 L15,1 C16.1045695,1 17,1.8954305 17,3 L17,4 L20,4 C21.1045695,4 22,4.8954305 22,6 L22,8 C22,9.1045695 21.1045695,10 20,10 L19.9198662,10 L19,21 C19,22.1045695 18.1045695,23 17,23 L7,23 C5.8954305,23 5,22.1045695 5.00345424,21.0830455 L4.07986712,10 L4,10 C2.8954305,10 2,9.1045695 2,8 L2,6 C2,4.8954305 2.8954305,4 4,4 L7,4 Z M7,6 L4,6 L4,8 L20,8 L20,6 L17,6 L7,6 Z M6.08648886,10 L7,21 L17,21 L17.0034542,20.9169545 L17.9132005,10 L6.08648886,10 Z M15,4 L15,3 L9,3 L9,4 L15,4 Z"
											/>
										</svg>
									</button>
								</span>
							{/if}
							<AddStar
								sendReaction={getSendReaction(webbookmark)}
								{sendDeletion}
								{loginPubkey}
								{profileMap}
								eventsReactionToTheTarget={getEventsReactionToTheTarget(
									webbookmark,
									eventsReaction
								)}
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
							{#if isDevMode}
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
							{/if}
						</dd>
					{/each}
				</dl>
			</dd>
		{/each}
	</dl>
</main>
<footer><a href={linkGitHub} target="_blank" rel="noopener noreferrer">GitHub</a></footer>

<style>
	header {
		display: flex;
		justify-content: space-between;
	}
	.setting {
		align-content: center;
	}
	.setting > input,
	.setting > label {
		vertical-align: top;
	}
	.login-user {
		width: 48px;
		height: 48px;
		border-radius: 10%;
	}
	summary {
		width: 100%;
	}
	.url > dt {
		border-radius: 5px;
		padding: 5px;
		background-color: rgba(0, 0, 0, 0.2);
	}
	.entry > dt {
		margin-top: 1em;
	}
	.entry > dd {
		margin-bottom: 1em;
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
	span.url {
		font-size: small;
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
		border-radius: 10%;
	}
	.category-tag,
	.hashtag {
		margin-left: 0.5em;
	}
	button.category-delete,
	button.bookmark-delete {
		border: none;
		outline: none;
		padding: 0;
		height: 16px;
		cursor: pointer;
		margin: 0;
		background-color: rgba(127, 127, 127, 0);
		border-radius: 10%;
	}
	button.category-delete {
		vertical-align: sub;
	}
	button.category-delete > svg,
	button.bookmark-delete > svg {
		width: 16px;
		height: 16px;
		fill: var(--text-bright);
	}
	button.category-delete:active > svg,
	button.bookmark-delete:active > svg {
		fill: yellow;
	}
	footer {
		text-align: center;
	}
</style>
