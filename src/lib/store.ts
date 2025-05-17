import { persisted } from 'svelte-persisted-store';

export const preferences = persisted<
	{
		loginPubkey: string | undefined;
	},
	{
		loginPubkey: string | undefined;
	}
>('preferences', {
	loginPubkey: undefined
});
