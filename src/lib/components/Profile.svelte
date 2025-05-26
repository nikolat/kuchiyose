<script lang="ts">
	import { getRoboHashURL } from '$lib/config';
	import type { NostrEvent } from 'nostr-tools/pure';
	import * as nip05 from 'nostr-tools/nip05';
	import * as nip19 from 'nostr-tools/nip19';
	import type { ProfileContent } from 'applesauce-core/helpers';
	import Content from '$lib/components/Content.svelte';

	const {
		pubkey,
		profile,
		isLoggedIn,
		isMutedPubkeyPage,
		mutePubkey,
		unmutePubkey,
		eventsComment,
		level,
		idReferenced,
		getSeenOn,
		fork,
		sendComment,
		sendReaction,
		sendDeletion,
		loginPubkey,
		profileMap,
		eventsReaction,
		eventsEmojiSet,
		eventsQuoted
	}: {
		pubkey: string;
		profile: ProfileContent | undefined;
		isLoggedIn: boolean;
		isMutedPubkeyPage: boolean;
		mutePubkey: () => Promise<void>;
		unmutePubkey: () => Promise<void>;
		eventsComment: NostrEvent[];
		level: number;
		idReferenced: string | undefined;
		getSeenOn: (id: string, excludeWs: boolean) => string[];
		fork: (event: NostrEvent) => void;
		sendComment: (content: string, targetEventToReply: NostrEvent) => Promise<void>;
		sendReaction: (event: NostrEvent, content?: string, emojiurl?: string) => Promise<void>;
		sendDeletion: (event: NostrEvent) => Promise<void>;
		loginPubkey: string | undefined;
		profileMap: Map<string, ProfileContent>;
		eventsReaction: NostrEvent[];
		eventsEmojiSet: NostrEvent[];
		eventsQuoted: NostrEvent[];
	} = $props();

	const nip05string = $derived(profile?.nip05);
	const banner = $derived(
		profile?.banner !== undefined && URL.canParse(profile.banner) ? profile.banner : undefined
	);
	const picture = $derived(
		profile?.picture !== undefined && URL.canParse(profile.picture)
			? profile.picture
			: getRoboHashURL(pubkey)
	);
	const display_name = $derived(profile?.display_name);
	const name = $derived(profile?.name ?? nip19.npubEncode(pubkey));
	const website = $derived(
		profile?.website !== undefined && URL.canParse(profile.website) ? profile.website : undefined
	);
	const about = $derived(profile?.about);
</script>

<section class="profile">
	<div class="banner">
		{#if banner !== undefined}
			<img src={banner} alt="banner" class="banner" />
		{/if}
	</div>
	<div class="picture">
		<img src={picture} alt={name.slice(0, 20)} class="picture" />
	</div>
	<h2 class="display_name">
		{display_name ?? ''}
		{#if isLoggedIn}
			{#if isMutedPubkeyPage}
				<button
					type="button"
					class="svg unmute-pubkey"
					title={`unmute @${name.slice(0, 20)}`}
					aria-label={`unmute @${name.slice(0, 20)}`}
					onclick={unmutePubkey}
				>
					<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
						<path
							fill-rule="evenodd"
							d="M20.0980654,15.8909586 L18.6838245,14.4767177 C19.3180029,13.8356474 19.9009094,13.1592525 20.4222529,12.4831239 C20.5528408,12.3137648 20.673512,12.1521776 20.7838347,12 C20.673512,11.8478224 20.5528408,11.6862352 20.4222529,11.5168761 C19.8176112,10.7327184 19.1301624,9.94820254 18.37596,9.21885024 C16.2825083,7.1943753 14.1050769,6 12,6 C11.4776994,6 10.9509445,6.07352686 10.4221233,6.21501656 L8.84014974,4.63304296 C9.8725965,4.22137709 10.9270589,4 12,4 C14.7275481,4 17.3356792,5.4306247 19.76629,7.78114976 C20.5955095,8.58304746 21.3456935,9.43915664 22.0060909,10.2956239 C22.4045936,10.8124408 22.687526,11.2189945 22.8424353,11.4612025 L23.1870348,12 L22.8424353,12.5387975 C22.687526,12.7810055 22.4045936,13.1875592 22.0060909,13.7043761 C21.4349259,14.4451181 20.7965989,15.1855923 20.0980652,15.8909583 L20.0980654,15.8909586 Z M17.0055388,18.4197523 C15.3942929,19.4304919 13.7209154,20 12,20 C9.27245185,20 6.66432084,18.5693753 4.23371003,16.2188502 C3.40449054,15.4169525 2.65430652,14.5608434 1.99390911,13.7043761 C1.59540638,13.1875592 1.31247398,12.7810055 1.15756471,12.5387975 L0.812965202,12 L1.15756471,11.4612025 C1.31247398,11.2189945 1.59540638,10.8124408 1.99390911,10.2956239 C2.65430652,9.43915664 3.40449054,8.58304746 4.23371003,7.78114976 C4.6043191,7.42275182 4.9790553,7.0857405 5.35771268,6.77192624 L1.29289322,2.70710678 L2.70710678,1.29289322 L22.7071068,21.2928932 L21.2928932,22.7071068 L17.0055388,18.4197523 Z M6.77972015,8.19393371 C6.39232327,8.50634201 6.00677809,8.84872289 5.62403997,9.21885024 C4.86983759,9.94820254 4.18238879,10.7327184 3.57774714,11.5168761 C3.44715924,11.6862352 3.32648802,11.8478224 3.21616526,12 C3.32648802,12.1521776 3.44715924,12.3137648 3.57774714,12.4831239 C4.18238879,13.2672816 4.86983759,14.0517975 5.62403997,14.7811498 C7.71749166,16.8056247 9.89492315,18 12,18 C13.1681669,18 14.3586152,17.6321975 15.5446291,16.9588426 L14.0319673,15.4461809 C13.4364541,15.7980706 12.7418086,16 12,16 C9.790861,16 8,14.209139 8,12 C8,11.2581914 8.20192939,10.5635459 8.55381909,9.96803265 L6.77972015,8.19393371 Z M10.0677432,11.4819568 C10.0235573,11.6471834 10,11.8208407 10,12 C10,13.1045695 10.8954305,14 12,14 C12.1791593,14 12.3528166,13.9764427 12.5180432,13.9322568 L10.0677432,11.4819568 Z"
						/>
					</svg>
				</button>
			{:else}
				<button
					type="button"
					class="svg mute-pubkey"
					title={`mute @${name.slice(0, 20)}`}
					aria-label={`mute @${name.slice(0, 20)}`}
					onclick={mutePubkey}
				>
					<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
						<path
							fill-rule="evenodd"
							d="M20.0980654,15.8909586 L18.6838245,14.4767177 C19.3180029,13.8356474 19.9009094,13.1592525 20.4222529,12.4831239 C20.5528408,12.3137648 20.673512,12.1521776 20.7838347,12 C20.673512,11.8478224 20.5528408,11.6862352 20.4222529,11.5168761 C19.8176112,10.7327184 19.1301624,9.94820254 18.37596,9.21885024 C16.2825083,7.1943753 14.1050769,6 12,6 C11.4776994,6 10.9509445,6.07352686 10.4221233,6.21501656 L8.84014974,4.63304296 C9.8725965,4.22137709 10.9270589,4 12,4 C14.7275481,4 17.3356792,5.4306247 19.76629,7.78114976 C20.5955095,8.58304746 21.3456935,9.43915664 22.0060909,10.2956239 C22.4045936,10.8124408 22.687526,11.2189945 22.8424353,11.4612025 L23.1870348,12 L22.8424353,12.5387975 C22.687526,12.7810055 22.4045936,13.1875592 22.0060909,13.7043761 C21.4349259,14.4451181 20.7965989,15.1855923 20.0980652,15.8909583 L20.0980654,15.8909586 Z M17.0055388,18.4197523 C15.3942929,19.4304919 13.7209154,20 12,20 C9.27245185,20 6.66432084,18.5693753 4.23371003,16.2188502 C3.40449054,15.4169525 2.65430652,14.5608434 1.99390911,13.7043761 C1.59540638,13.1875592 1.31247398,12.7810055 1.15756471,12.5387975 L0.812965202,12 L1.15756471,11.4612025 C1.31247398,11.2189945 1.59540638,10.8124408 1.99390911,10.2956239 C2.65430652,9.43915664 3.40449054,8.58304746 4.23371003,7.78114976 C4.6043191,7.42275182 4.9790553,7.0857405 5.35771268,6.77192624 L1.29289322,2.70710678 L2.70710678,1.29289322 L22.7071068,21.2928932 L21.2928932,22.7071068 L17.0055388,18.4197523 Z M6.77972015,8.19393371 C6.39232327,8.50634201 6.00677809,8.84872289 5.62403997,9.21885024 C4.86983759,9.94820254 4.18238879,10.7327184 3.57774714,11.5168761 C3.44715924,11.6862352 3.32648802,11.8478224 3.21616526,12 C3.32648802,12.1521776 3.44715924,12.3137648 3.57774714,12.4831239 C4.18238879,13.2672816 4.86983759,14.0517975 5.62403997,14.7811498 C7.71749166,16.8056247 9.89492315,18 12,18 C13.1681669,18 14.3586152,17.6321975 15.5446291,16.9588426 L14.0319673,15.4461809 C13.4364541,15.7980706 12.7418086,16 12,16 C9.790861,16 8,14.209139 8,12 C8,11.2581914 8.20192939,10.5635459 8.55381909,9.96803265 L6.77972015,8.19393371 Z M10.0677432,11.4819568 C10.0235573,11.6471834 10,11.8208407 10,12 C10,13.1045695 10.8954305,14 12,14 C12.1791593,14 12.3528166,13.9764427 12.5180432,13.9322568 L10.0677432,11.4819568 Z"
						/>
					</svg>
				</button>
			{/if}
		{/if}
	</h2>
	<div class="name">@{name}</div>
	{#if nip05.isNip05(nip05string)}
		{@const abbreviatedNip05 = nip05string.replace(/^_@/, '')}
		<div class="nip05">
			{#await nip05.isValid(pubkey, nip05string)}
				<span>❔{abbreviatedNip05}</span>
			{:then isValid}
				<span>{isValid ? '✅' : '❌'}{abbreviatedNip05}</span>
			{:catch error}
				<span title={error}>❌{abbreviatedNip05}</span>
			{/await}
		</div>
	{/if}
	{#if website !== undefined}
		<div class="website">
			🔗<a href={website} target="_blank" rel="noopener noreferrer">{website}</a>
		</div>
	{/if}
	<div class="about">
		<Content
			content={about ?? ''}
			{eventsComment}
			level={level + 1}
			{idReferenced}
			{getSeenOn}
			{fork}
			{sendComment}
			{sendReaction}
			{sendDeletion}
			{loginPubkey}
			{profileMap}
			{eventsReaction}
			{eventsEmojiSet}
			{eventsQuoted}
		/>
	</div>
</section>

<style>
	div.banner {
		height: 200px;
		background-color: rgba(127, 127, 127, 0.1);
	}
	img.banner {
		object-fit: cover;
		width: 100%;
		height: 200px;
	}
	div.picture {
		margin-left: 10px;
		margin-top: -48px;
	}
	img.picture {
		width: 96px;
		height: 96px;
		border-radius: 10%;
		object-fit: cover;
	}
	h2.display_name {
		margin: 0;
	}
	div.name {
		color: var(--text-muted);
	}
	div.about {
		white-space: pre-line;
	}
	button.svg {
		border: none;
		outline: none;
		padding: 0;
		height: 16px;
		margin: 0;
		background-color: rgba(127, 127, 127, 0);
		border-radius: 10%;
	}
	button.svg > svg {
		width: 16px;
		height: 16px;
		fill: var(--text-bright);
	}
	button.unmute-pubkey > svg {
		fill: pink;
	}
	button.svg:active > svg {
		fill: yellow;
	}
</style>
