import { persisted } from 'svelte-persisted-store';

export const preferences = persisted<
	{
		loginPubkey: string | undefined;
		isEnabledUseDarkMode: boolean;
		isEnabledUseClientTag: boolean;
	},
	{
		loginPubkey: string | undefined;
		isEnabledUseDarkMode: boolean;
		isEnabledUseClientTag: boolean;
	}
>('preferences', {
	loginPubkey: undefined,
	isEnabledUseDarkMode: false,
	isEnabledUseClientTag: false
});
