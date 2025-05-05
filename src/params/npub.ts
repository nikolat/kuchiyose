export function match(param: string) {
	return /^npub1\w{58}$/.test(param);
}
