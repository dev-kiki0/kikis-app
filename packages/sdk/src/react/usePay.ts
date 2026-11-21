import { useCallback, useEffect, useRef, useState } from 'react'
import type { PaymentOptions, PaymentResult } from '../types'
import { pay as payCore } from '../pay'

export interface UsePayReturn {
  loading: boolean
  result: PaymentResult | null
  error: Error | null
  pay: (overrideOptions?: PaymentOptions) => Promise<PaymentResult | null>
  reset: () => void
}

export function usePay(options: PaymentOptions): UsePayReturn {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<PaymentResult | null>(null)
  const [error, setError] = useState<Error | null>(null)

  const inFlightRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (abortRef.current) {
        abortRef.current.abort()
        abortRef.current = null
      }
    }
  }, [])

  const pay = useCallback(
    async (overrideOptions?: PaymentOptions): Promise<PaymentResult | null> => {
      if (inFlightRef.current) return null
      inFlightRef.current = true

      const unmountController = new AbortController()
      abortRef.current = unmountController

      if (mountedRef.current) {
        setLoading(true)
        setError(null)
      }

      try {
        const paymentResult = await payCore({
          ...options,
          ...overrideOptions,
          signal: controller.signal,
        })

        if (mountedRef.current) {
          setResult(paymentResult)
        }

        return paymentResult
      } catch (err) {
        const normalized = err instanceof Error ? err : new Error(String(err))

        if (mountedRef.current) {
          setError(normalized)
        }

        return null
      } finally {
        inFlightRef.current = false
        if (abortRef.current === unmountController) {
          abortRef.current = null
        }
        if (mountedRef.current) {
          setLoading(false)
        }
      }
    },
    [options],
  )

  const reset = useCallback(() => {
    setResult(null)
    setError(null)
    // Keep loading true while a request is still in flight so consumers do not
    // present an enabled action that would silently no-op. The active request
    // clears loading in its own finally block on completion.
    if (!inFlightRef.current) {
      setLoading(false)
    }
  }, [])

  return { loading, result, error, pay, reset }
}
