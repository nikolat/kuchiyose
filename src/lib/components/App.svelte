<script lang="ts">
	import { onMount } from 'svelte';
	import { afterNavigate, beforeNavigate } from '$app/navigation';
	import { getRoboHashURL, linkGitHub } from '$lib/config';
	import { RelayConnector, type UrlParams } from '$lib/resource';
	import { now } from 'rx-nostr';
	import type { ProfileContent } from 'applesauce-core/helpers';
	import { nip19 } from 'nostr-tools';
	import type { NostrEvent } from 'nostr-tools/pure';

	const {
		up
	}: {
		up: UrlParams;
	} = $props();

	let loginPubkey: string | undefined = $state();
	let rc: RelayConnector | undefined = $state();
	let webBookmarkMap: { url: string; webbookmarks: NostrEvent[] }[] = $state([]);
	let profileMap: { pubkey: string; profile: ProfileContent }[] = $state([]);
	let idTimeoutLoading: number;
	let editDTag: string = $state('');
	let editTag: string = $state('');
	let editTags: string[] = $state([]);
	let editTagInput: HTMLInputElement | undefined = $state();
	let editContent: string = $state('');

	const callbackRelayRecord = () => {
		rc?.fetchWebBookmark(up);
	};

	const initFetch = () => {
		webBookmarkMap = [];
		rc?.dispose();
		rc = new RelayConnector(loginPubkey !== undefined);
		rc.subscribeEventStore(webBookmarkMap, profileMap, callbackRelayRecord);
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
		const event = webBookmarkMap
			.find(({ url }) => url === `https://${d}`)
			?.webbookmarks.find((ev) => ev.pubkey === loginPubkey);
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
		webBookmarkMap = [];
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
		<dl>
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
	<dl>
		{#each webBookmarkMap as { url, webbookmarks } (url)}
			<dt><a href={url} target="_blank" rel="noopener noreferrer">{url}</a></dt>
			<dd>
				<dl>
					{#each webbookmarks as webbookmark (webbookmark.pubkey)}
						{@const identifier =
							webbookmark.tags.find((tag) => tag.length >= 2 && tag[0] === 'd')?.at(1) ?? ''}
						{@const hashtags = new Set<string>(
							webbookmark.tags
								.filter((tag) => tag.length >= 2 && tag[0] === 't')
								.map((tag) => tag[1].toLowerCase())
						)}
						{@const prof = profileMap.find((p) => p.pubkey === webbookmark.pubkey)?.profile}
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
