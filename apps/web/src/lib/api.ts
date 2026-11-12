export class ApiError extends Error {
  constructor(
    message: string,
    public status = 0,
    public code = "NETWORK_ERROR",
  ) {
    super(message);
  }
}
export const requestId = () => `web_${crypto.randomUUID()}`;
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
export async function request<T>(
  token: string,
  path: string,
  options: {
    method?: string;
    body?: unknown;
    id?: string;
    signal?: AbortSignal;
    binary?: boolean;
    retry?: boolean;
    timeoutMs?: number;
  } = {},
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(`/api/coco${path}`, {
        method: options.method ?? "GET",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(options.body
            ? {
                "Content-Type":
                  options.body instanceof Blob
                    ? "audio/wav"
                    : "application/json",
              }
            : {}),
          ...(options.id ? { "X-Request-Id": options.id } : {}),
        },
        body:
          options.body instanceof Blob
            ? options.body
            : options.body
              ? JSON.stringify(options.body)
              : undefined,
        signal: AbortSignal.any([
          AbortSignal.timeout(options.timeoutMs ?? 30000),
          ...(options.signal ? [options.signal] : []),
        ]),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new ApiError(
          error.error?.message ?? `Coco returned ${response.status}.`,
          response.status,
          error.error?.code,
        );
      }
      return options.binary
        ? ((await response.blob()) as T)
        : await response.json();
    } catch (error) {
      if (options.signal?.aborted) throw error;
      if (
        (error instanceof ApiError &&
          (error.status < 500 || error.status === 503)) ||
        attempt === 2 ||
        options.retry === false
      )
        throw error instanceof ApiError
          ? error
          : new ApiError(
              "Could not reach Coco. Check your connection and retry.",
            );
      await sleep(500 * 2 ** attempt, options.signal);
    }
  }
  throw new ApiError("Coco did not respond.");
}
