export async function assistantRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body) headers.set("Content-Type", "application/json");
  const response = await fetch(path, {
    ...options,
    headers,
    cache: "no-store",
    credentials: "same-origin",
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    const error =
      body && typeof body === "object" && "error" in body
        ? String(body.error)
        : `Request failed (${response.status}).`;
    throw new Error(error);
  }
  return body as T;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The request could not be completed.";
}
