import type { RelayConnector } from '$lib/resource';
import type { NostrEvent } from 'nostr-tools/pure';

let rc: RelayConnector | undefined = $state();
let eventsQuoted: NostrEvent[] = $state([]);
let deadRelays: string[] = $state([]);

export const getRelayConnector = (): RelayConnector | undefined => {
	return rc;
};

export const setRelayConnector = (v: RelayConnector | undefined): void => {
	rc = v;
};

export const getEventsQuoted = (): NostrEvent[] => {
	return eventsQuoted;
};

export const setEventsQuoted = (v: NostrEvent[]): void => {
	eventsQuoted = v;
};

export const getDeadRelays = (): string[] => {
	return deadRelays;
};

export const setDeadRelays = (v: string[]): void => {
	deadRelays = v;
};
