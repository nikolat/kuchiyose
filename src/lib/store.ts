import { persisted } from 'svelte-persisted-store';

export const preferences = persisted<
	{
		loginPubkey: string | undefined;
		isAllowedQueryString: boolean;
		isEnabledUseDarkMode: boolean;
		isEnabledUseClientTag: boolean;
	},
	{
		loginPubkey: string | undefined;
		isAllowedQueryString: boolean;
		isEnabledUseDarkMode: boolean;
		isEnabledUseClientTag: boolean;
	}
>('preferences', {
	loginPubkey: undefined,
	isAllowedQueryString: false,
	isEnabledUseDarkMode: false,
	isEnabledUseClientTag: false
});
