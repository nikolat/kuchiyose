import { npubEncode } from 'nostr-tools/nip19';
import type { WindowNostr } from 'nostr-tools/nip07';

export const sitename = 'KUCHIYOSE';
export const defaultRelays = [
	'wss://relay-jp.nostr.wirednet.jp/',
	'wss://yabu.me/',
	'wss://nrelay.c-stellar.net/'
];
export const indexerRelays = [
	'wss://directory.yabu.me/',
	'wss://purplepag.es/',
	'wss://indexer.coracle.social/'
];
export const limitDepth = 5;
export const isEnabledOutboxModel = true;
export const expansionThreshold = 5;
export const defaultReactionToShow = '⭐';
export const defaultReactionToAdd = '+';
export const linkGitHub = 'https://github.com/nikolat/kuchiyose';
export const getRoboHashURL = (pubkey: string) => {
	return `https://robohash.org/${npubEncode(pubkey)}?set=set4`;
};

declare global {
	interface Window {
		nostr?: WindowNostr;
	}
}
