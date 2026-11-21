import { useCallback, useEffect, useRef, useState } from 'react'
import { useKikisApp } from './context.js'
import type { PaymentOptions, PaymentResult } from '../types.js'

export interface UsePayState {
  loading: boolean
  result: PaymentResult | null
  error: Error | null
  pay: (options?: PaymentOptions) => Promise<PaymentResult | null>
  reset: () => void
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false
  }
  const aKeys = Object.keys(a as Record<string, unknown>)
  const bKeys = Object.keys(b as Record<string, unknown>)
  if (aKeys.length !== bKeys.length) return false
  for (const key of aKeys) {
    if ((a as Record<string, unknown>)[key] !== (b as Record<string, unknown>)[key]) {
      return false
    }
  }
  return true
}

export function usePay(url: string, options?: PaymentOptions): UsePayState {
  const client = useKikisApp()
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<PaymentResult | null>(null)
  const [error, setError] = useState<Error | null>(null)

  const inFlightRef = useRef(false)
  const mountedRef = useRef(true)
  const abortRef = useRef<AbortController | null>(null)
  const optionsRef = useRef<PaymentOptions | undefined>(options)

  if (!shallowEqual(optionsRef.current, options)) {
    optionsRef.current = options
  }

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      abortRef.current?.abort()
      abortRef.current = null
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
        const mergedOptions = overrideOptions ?? optionsRef.current
        const callerSignal = mergedOptions?.signal
        
        // If the caller provided a signal, chain it to our unmount controller
        // so either abort reason (caller or unmount) will reject the payment.
        // Create a new AbortController that aborts when either signal aborts.
        const paymentController = new AbortController()
        let unmountAbort: (() => void) | null = null
        
        if (callerSignal) {
          // When caller's signal aborts, abort our payment controller
          if (callerSignal.aborted) {
            paymentController.abort(callerSignal.reason)
          } else {
            const abortHandler = () => paymentController.abort(callerSignal.reason)
            callerSignal.addEventListener('abort', abortHandler)
            unmountAbort = () => callerSignal.removeEventListener('abort', abortHandler)
          }
        }
        
        // When unmount happens, also abort the payment
        if (!unmountController.signal.aborted) {
          const abortHandler = () => paymentController.abort(unmountController.signal.reason)
          unmountController.signal.addEventListener('abort', abortHandler)
          const cleanup = unmountAbort
          unmountAbort = () => {
            cleanup?.()
            unmountController.signal.removeEventListener('abort', abortHandler)
          }
        }
        
        try {
          const res = await client.pay(url, {
            ...mergedOptions,
            signal: paymentController.signal,
          })
          if (mountedRef.current && !paymentController.signal.aborted) {
            setResult(res)
          }
          return res
        } finally {
          unmountAbort?.()
        }
      } catch (err) {
        if (mountedRef.current && !unmountController.signal.aborted) {
          setError(err instanceof Error ? err : new Error(String(err)))
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
    [client, url],
  )

  const reset = useCallback(() => {
    setResult(null)
    setError(null)
    setLoading(false)
  }, [])

  return { loading, result, error, pay, reset }
}
