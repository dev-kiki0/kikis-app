import type { HttpRequestOptions } from '../types.js'

/**
 * Prepares the RequestInit structure for fetch calls, merging user-provided
 * HttpRequestOptions with internal headers (such as payment headers or
 * mode headers).
 *
 * Preserves the HTTP method, headers, and body across probes and settlement.
 * Objects provided as body are serialized as JSON and Content-Type: application/json
 * is added if not already present.
 */
export function prepareHttpRequestInit(
  requestOptions?: HttpRequestOptions,
  extraHeaders?: Record<string, string>,
): {
  method: string
  headers: Record<string, string>
  body?: BodyInit
} {
  const method = requestOptions?.method ? requestOptions.method.toUpperCase() : 'GET'
  const userHeaders = requestOptions?.headers ?? {}
  const headers: Record<string, string> = { ...userHeaders, ...extraHeaders }

  let body: BodyInit | undefined

  if (requestOptions?.body !== undefined && requestOptions?.body !== null) {
    if (typeof requestOptions.body === 'string') {
      body = requestOptions.body
    } else if (requestOptions.body instanceof Uint8Array) {
      // Node Buffers extend Uint8Array, so they take this branch too.
      body = requestOptions.body as unknown as BodyInit
    } else if (typeof requestOptions.body === 'object') {
      body = JSON.stringify(requestOptions.body)
      const hasContentType = Object.keys(headers).some(
        (h) => h.toLowerCase() === 'content-type',
      )
      if (!hasContentType) {
        headers['Content-Type'] = 'application/json'
      }
    } else {
      body = String(requestOptions.body)
    }
  }

  if (method === 'GET' || method === 'HEAD') {
    return { method, headers }
  }

  return { method, headers, ...(body !== undefined ? { body } : {}) }
}
