<script lang="ts">
	import { urlLinkString } from '$lib/utils';

	let {
		content
	}: {
		content: string;
	} = $props();

	const getExpandTagsList = (content: string): [IterableIterator<RegExpMatchArray>, string[]] => {
		const regMatchArray = ['https?://[\\w!?/=+\\-_~:;.,*&@#$%()[\\]]+'];
		const regMatch = new RegExp(regMatchArray.map((v) => '(' + v + ')').join('|'), 'g');
		const regSplit = new RegExp(regMatchArray.join('|'));
		return [content.matchAll(regMatch), content.split(regSplit)];
	};

	const [matchesIterator, plainTexts] = $derived(getExpandTagsList(content));
</script>

{plainTexts[0]}{#each Array.from(matchesIterator) as match, i (i)}
	{@const urlHttp = match[1]}
	{#if /^https?:\/\/\S+/.test(urlHttp) && URL.canParse(urlHttp)}
		{@const [url, rest] = urlLinkString(urlHttp)}
		<a href={url} target="_blank" rel="noopener noreferrer">{url}</a>{rest}
	{/if}{plainTexts[i + 1]}
{/each}
