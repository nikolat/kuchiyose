<script lang="ts">
	import { getRoboHashURL } from '$lib/config';
	import * as nip05 from 'nostr-tools/nip05';
	import * as nip19 from 'nostr-tools/nip19';
	import type { ProfileContent } from 'applesauce-core/helpers';

	const {
		pubkey,
		profile
	}: {
		pubkey: string;
		profile: ProfileContent | undefined;
	} = $props();

	let nip05string = $derived(profile?.nip05);
	let banner = $derived(profile?.banner);
	let display_name = $derived(profile?.display_name);
	let name = $derived(profile?.name);
</script>

<section class="profile">
	<div class="banner">
		{#if banner !== undefined && URL.canParse(banner)}<img
				src={banner}
				alt="banner"
				class="banner"
			/>{/if}
	</div>
	<div class="picture">
		<img
			src={profile?.picture ?? getRoboHashURL(pubkey)}
			alt={profile?.name ?? ''}
			class="picture"
		/>
	</div>
	{#if display_name !== undefined}
		<h2 class="display_name">{display_name}</h2>
	{/if}
	{#if name !== undefined}
		<div class="name">@{name}</div>
	{:else}
		<div class="name">@{nip19.npubEncode(pubkey)}</div>
	{/if}
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
	{#if profile?.website !== undefined && URL.canParse(profile.website)}
		<div class="website">
			🔗<a href={profile.website} target="_blank" rel="noopener noreferrer">{profile.website}</a>
		</div>
	{/if}
	<div class="about">{profile?.about ?? ''}</div>
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
</style>
