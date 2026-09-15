export const NEXON_ATTRIBUTION = "Data based on NEXON Open API";

export class ApiResponseError extends Error {
  readonly status: number;
  readonly code: string;
  readonly responseHeaders: HeadersInit;

  constructor(
    status: number,
    code: string,
    message: string,
    responseHeaders: HeadersInit = {},
  ) {
    super(message);
    this.name = "ApiResponseError";
    this.status = status;
    this.code = code;
    this.responseHeaders = responseHeaders;
  }
}

export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  if (origin === "null") return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function appendVary(headers: Headers, field: string): void {
  const existing = headers.get("Vary");
  const values = (existing ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!values.some((value) => value.toLowerCase() === field.toLowerCase())) {
    values.push(field);
  }
  headers.set("Vary", values.join(", "));
}

export function jsonResponse(
  body: unknown,
  init: ResponseInit = {},
): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Data-Attribution", NEXON_ATTRIBUTION);
  return new Response(JSON.stringify(body), { ...init, headers });
}

export function withSameOriginCors(
  response: Response,
  request: Request,
): Response {
  const headers = new Headers(response.headers);
  const origin = request.headers.get("Origin");
  if (origin && isSameOriginRequest(request)) {
    headers.set("Access-Control-Allow-Origin", new URL(request.url).origin);
  } else {
    headers.delete("Access-Control-Allow-Origin");
  }
  appendVary(headers, "Origin");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function errorResponse(
  error: ApiResponseError,
  request: Request,
): Response {
  const response = jsonResponse(
    {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
      },
      attribution: NEXON_ATTRIBUTION,
    },
    {
      status: error.status,
      headers: {
        "Cache-Control": "no-store",
        ...Object.fromEntries(new Headers(error.responseHeaders)),
      },
    },
  );
  return withSameOriginCors(response, request);
}

export function preflightResponse(request: Request): Response {
  const response = new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Accept, Content-Type",
      "Access-Control-Max-Age": "86400",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Data-Attribution": NEXON_ATTRIBUTION,
    },
  });
  return withSameOriginCors(response, request);
}
