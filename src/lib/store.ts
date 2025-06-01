import { persisted } from 'svelte-persisted-store';

export const preferences = persisted<
	{
		loginPubkey: string | undefined;
		isEnabledUseClientTag: boolean;
	},
	{
		loginPubkey: string | undefined;
		isEnabledUseClientTag: boolean;
	}
>('preferences', {
	loginPubkey: undefined,
	isEnabledUseClientTag: false
});
