const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Call only after the HTTP access gate; Next can normalize its URL to localhost. */
export function calendarAuthorizationCallback(request: Request): string {
  const requestUrl = new URL(request.url);
  const host = request.headers.get("host") ?? requestUrl.host;
  const browserUrl = new URL(`${requestUrl.protocol}//${host}`);
  const localAlias = loopbackHosts.has(requestUrl.hostname) && loopbackHosts.has(browserUrl.hostname);
  if (browserUrl.username || browserUrl.password || browserUrl.pathname !== "/" || browserUrl.search || browserUrl.hash
    || browserUrl.port !== requestUrl.port || (!localAlias && browserUrl.hostname !== requestUrl.hostname)
    || !["http:", "https:"].includes(browserUrl.protocol))
    throw new Error("The calendar return origin is invalid.");
  const origin = request.headers.get("origin");
  if (origin && origin !== browserUrl.origin)
    throw new Error("The calendar return origin does not match this browser.");
  const destination = new URL("/assistant?view=connections&calendar=return", browserUrl.origin);
  // Connect's service currently permits HTTP localhost return URLs but rejects
  // HTTP 127.0.0.1 despite the SDK accepting it. A local redirect restores the
  // original browser origin without moving browser session state to localhost.
  if (browserUrl.protocol === "http:" && browserUrl.hostname !== "localhost") {
    const bridge = new URL("/api/assistant/calendar/return", `http://localhost:${browserUrl.port || "80"}`);
    bridge.searchParams.set("origin", browserUrl.origin);
    return bridge.href;
  }
  return destination.href;
}

/** Public redirect only, with no credential exchange or calendar/session access. */
export function calendarReturnDestination(request: Request, environment: {NODE_ENV?: string} = process.env): string {
  if (environment.NODE_ENV !== "development") throw new Error("The local calendar return bridge is disabled.");
  const url = new URL(request.url);
  const host = new URL(`${url.protocol}//${request.headers.get("host") ?? url.host}`);
  const values = url.searchParams.getAll("origin");
  if (values.length !== 1 || !loopbackHosts.has(url.hostname) || !loopbackHosts.has(host.hostname) || host.port !== url.port)
    throw new Error("The local calendar return origin is invalid.");
  const target = new URL(values[0]);
  if (target.protocol !== "http:" || !loopbackHosts.has(target.hostname) || target.port !== url.port || target.origin !== values[0])
    throw new Error("The local calendar return origin is invalid.");
  return new URL("/assistant?view=connections&calendar=return", target.origin).href;
}
