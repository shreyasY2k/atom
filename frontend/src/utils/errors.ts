/**
 * Extracts a human-readable message from API errors.
 *
 * FastAPI errors look like: { detail: "message" } or { detail: [{msg: "..."}] }
 * Network/runtime errors look like: Error instances with .message
 * Unknown shapes fall back to a generic string.
 */
export function extractErrorMessage(e: unknown, fallback = 'An unexpected error occurred'): string {
  if (!e) return fallback

  // FastAPI shape: { detail: string }
  if (typeof e === 'object' && e !== null) {
    const obj = e as Record<string, unknown>

    if (typeof obj.detail === 'string' && obj.detail) {
      return obj.detail
    }

    // FastAPI validation shape: { detail: [{msg: "..."}] }
    if (Array.isArray(obj.detail)) {
      const msgs = obj.detail
        .map((d: unknown) => (typeof d === 'object' && d !== null ? (d as Record<string, unknown>).msg : String(d)))
        .filter(Boolean)
      if (msgs.length > 0) return msgs.join('; ')
    }

    // Standard Error object
    if (typeof obj.message === 'string' && obj.message) {
      return obj.message
    }
  }

  // Primitive string
  if (typeof e === 'string' && e) return e

  return fallback
}
