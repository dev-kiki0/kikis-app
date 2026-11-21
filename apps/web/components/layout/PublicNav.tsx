'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

export function PublicNav() {
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 20)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <nav
      aria-label="Primary"
      className={cn(
        'fixed top-0 inset-x-0 z-50 transition-all duration-200',
        scrolled
          ? 'bg-[var(--bg-base)]/80 backdrop-blur-sm border-b border-[var(--border-default)]'
          : 'bg-transparent',
      )}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <span className="font-bold text-[var(--text-primary)] tracking-tight">
              Route<span className="text-[var(--accent)]">Dock</span>
            </span>
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--status-success)] animate-pulse" />
          </div>

          {/* Center nav — desktop only */}
          <div className="hidden md:flex items-center gap-6">
            <a
              href="#features"
              className="text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            >
              Features
            </a>
            <a
              href="#how-it-works"
              className="text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            >
              How it Works
            </a>
            <a
              href="#faq"
              className="text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            >
              FAQ
            </a>
            <a
              href="/dashboard"
              className="text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            >
              Dashboard
            </a>
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-3">
            <code className="hidden sm:inline-flex items-center rounded-md border border-[var(--border-default)] bg-[var(--bg-subtle)] px-2.5 py-1 text-xs font-mono text-[var(--text-secondary)]">
              npm i @kikis-app/kikis-app
            </code>
            <Link
              href="https://github.com/winsznx/kikis-app"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center rounded-lg border border-[var(--border-default)] bg-transparent px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] transition-colors"
            >
              GitHub
            </Link>
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              aria-controls="public-nav-mobile-menu"
              aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
              className="md:hidden inline-flex items-center justify-center rounded-lg border border-[var(--border-default)] bg-transparent p-1.5 text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] transition-colors"
            >
              <svg
                className="h-5 w-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                {menuOpen ? (
                  <>
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </>
                ) : (
                  <>
                    <line x1="3" y1="6" x2="21" y2="6" />
                    <line x1="3" y1="12" x2="21" y2="12" />
                    <line x1="3" y1="18" x2="21" y2="18" />
                  </>
                )}
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile nav — below desktop breakpoint */}
        {menuOpen && (
          <div
            id="public-nav-mobile-menu"
            className="md:hidden flex flex-col gap-1 border-t border-[var(--border-default)] py-3"
          >
            <a
              href="#features"
              onClick={() => setMenuOpen(false)}
              className="rounded-md px-2 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] transition-colors"
            >
              Features
            </a>
            <a
              href="#how-it-works"
              onClick={() => setMenuOpen(false)}
              className="rounded-md px-2 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] transition-colors"
            >
              How it Works
            </a>
            <a
              href="#faq"
              onClick={() => setMenuOpen(false)}
              className="rounded-md px-2 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] transition-colors"
            >
              FAQ
            </a>
            <a
              href="/dashboard"
              onClick={() => setMenuOpen(false)}
              className="rounded-md px-2 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] transition-colors"
            >
              Dashboard
            </a>
          </div>
        )}
      </div>
    </nav>
  )
}
