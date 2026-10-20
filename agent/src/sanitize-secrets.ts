const STELLAR_SECRET_PATTERN = /(^|[^A-Z2-7])(S[A-Z2-7]{55})(?![A-Z2-7])/g

export function sanitizeSecrets(value: string): string {
  return value.replace(STELLAR_SECRET_PATTERN, '$1S***...')
}