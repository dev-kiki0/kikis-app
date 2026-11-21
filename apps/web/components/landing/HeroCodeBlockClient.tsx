'use client'

import { useState, useEffect, useRef } from 'react'
import { Copy, Check, X } from 'lucide-react'

interface HeroCodeBlockClientProps {
  html: string
  code: string
}

type CopyStatus = 'idle' | 'copied' | 'error'

export function HeroCodeBlockClient({ html, code }: HeroCodeBlockClientProps) {
  const [copyStatus, setCopyStatus] = useState<CopyStatus>('idle')
  const [announcement, setAnnouncement] = useState<string>('')
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clean up timer on unmount to prevent memory leaks and stale timer callbacks.
  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  async function handleCopy() {
    // Cancel any pending timer from a previous copy attempt so its callback
    // won't override the new result. (#4)
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }

    try {
      await navigator.clipboard.writeText(code)
      setCopyStatus('copied')
      // Announce to screen reader users that the copy succeeded. (#2)
      setAnnouncement('Code copied to clipboard')
    } catch {
      setCopyStatus('error')
      // Announce to screen reader users that the copy failed. (#2)
      setAnnouncement('Failed to copy code to clipboard')
    }
    
    // Schedule the reset. Store the timeout ID so it can be cancelled if the
    // user tries to copy again before this one completes. (#4)
    timeoutRef.current = setTimeout(() => {
      setCopyStatus('idle')
      setAnnouncement('')
      timeoutRef.current = null
    }, 2000)
  }

  return (
    <>
      {/* Live region for screen reader announcements of copy status. (#2) */}
      <div
        role="status"
        aria-live="polite"
        className="sr-only"
      >
        {announcement}
      </div>
      
      <div className="relative rounded-xl bg-[#0D1117] border border-white/10 overflow-hidden font-mono text-xs sm:text-sm">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10">
          <div className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full bg-[#FF5F56]" />
            <span className="h-3 w-3 rounded-full bg-[#FFBD2E]" />
            <span className="h-3 w-3 rounded-full bg-[#27C93F]" />
          </div>
          <button
            onClick={handleCopy}
            aria-label={
              copyStatus === 'copied'
                ? 'Code copied to clipboard'
                : copyStatus === 'error'
                  ? 'Failed to copy code'
                  : 'Copy code'
            }
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-white/40 hover:text-white/80 hover:bg-white/5 transition-colors"
          >
            {copyStatus === 'copied' ? (
              <>
                <Check className="h-3.5 w-3.5" />
                Copied
              </>
            ) : copyStatus === 'error' ? (
              <>
                <X className="h-3.5 w-3.5 text-[var(--status-error)]" />
                <span className="text-[var(--status-error)]">Copy failed</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                Copy
              </>
            )}
          </button>
        </div>
        <div
          className="p-5 [&_pre]:!bg-transparent [&_code]:text-sm [&_pre]:overflow-x-auto"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </>
  )
}
