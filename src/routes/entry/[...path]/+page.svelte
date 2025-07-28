<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import App from '$lib/components/App.svelte';

	let path: string | undefined = $state();

	afterNavigate(() => {
		if (page.params.path === undefined) {
			throw new TypeError('path is undefined');
		}
		path = encodeURI(page.params.path);
	});
</script>

<App up={{ path }} />
