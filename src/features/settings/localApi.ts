export const LOCAL_API_DEFAULT_PORT = 11435;
export const LOCAL_API_LOOPBACK_HOST = "127.0.0.1";
export const LOCAL_API_LAN_HOST = "0.0.0.0";

// A server bound to every interface is reached at the computer's LAN address.
export const localApiReachableHost = (host: string, lanIp?: string | null) =>
  host === LOCAL_API_LAN_HOST ? (lanIp ?? host) : host;
