// Injected into the isolated Core bundle only. Unrecognised outbound requests
// fail closed; no call ever falls through to the public network.
export function fetch(){throw Error('external_network_disabled_in_qa_core');}
