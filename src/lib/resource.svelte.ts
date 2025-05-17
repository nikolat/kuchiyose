import type { RelayConnector } from '$lib/resource';

let rc: RelayConnector | undefined = $state();

export const getRelayConnector = (): RelayConnector | undefined => {
	return rc;
};

export const setRelayConnector = (v: RelayConnector | undefined) => {
	rc = v;
};
