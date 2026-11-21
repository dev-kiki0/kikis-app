import type { SupabaseClient } from '@supabase/supabase-js'

export interface SessionWritersConfig {
  payee: string
  network: string
  channelContract: string
  providerUrl: string
}

export interface OrphanedState {
  cumulativeAmount: string
  lastSignature: string
  voucherCount: number
  reason: string
}

export interface SessionWriters {
  onSessionOpen: (channelId: string, payer: string) => Promise<void>
  onVoucher: (
    channelId: string,
    voucherCount: number,
    cumulativeAmount: string,
    lastSignature: string,
  ) => Promise<void>
  onOrphaned: (channelId: string, state: OrphanedState) => Promise<void>
  onSettled: (
    txHash: string,
    totalPaid: string,
    mode: string,
    payer: string,
  ) => Promise<void>
}

export function createSessionWriters(
  supabase: SupabaseClient | null,
  config: SessionWritersConfig,
): SessionWriters {
  const { network, channelContract, providerUrl } = config

  // Tracks the in-flight (or settled) session insert per channel so voucher
  // writes can be ordered after row creation.
  const sessionInserts = new Map<string, Promise<void>>()

  return {
    onSessionOpen: async (channelId, payer) => {
      if (!supabase) return
      const { error } = await supabase.from('sessions').insert({
        channel_id: channelId,
        payer,
        status: 'open',
        cumulative_amount: '0',
        voucher_count: 0,
        network,
        provider_url: providerUrl,
      })
      if (error) console.error('[supabase] session open failed:', error.message)
    },

    onVoucher: async (channelId, voucherCount, cumulativeAmount, lastSignature) => {
      if (!supabase) return

      // Order the first (and any racing) voucher write after the session row
      // exists. A failed insert is observable here rather than silently
      // dropping the voucher.
      const pendingInsert = sessionInserts.get(channelId)
      if (pendingInsert) {
        try {
          await pendingInsert
        } catch (err) {
          console.error('[supabase] voucher update skipped: session insert failed', {
            channelId,
            error: err instanceof Error ? err.message : String(err),
          })
          throw err
        }
      }

      const { error } = await supabase
        .from('sessions')
        .update({
          cumulative_amount: cumulativeAmount,
          voucher_count: voucherCount,
          last_signature: lastSignature,
        })
        .eq('channel_id', channelId)
        .lt('cumulative_amount', cumulativeAmount)
      if (error) {
        console.error('[supabase] voucher update failed:', error.message)
        throw new Error(`[supabase] voucher update failed: ${error.message}`)
      }
    },

    onOrphaned: async (channelId, state) => {
      if (!supabase) return
      // Flag the row `closing` first so a clean settlement can still close it.
      const { error: flagError } = await supabase
        .from('sessions')
        .update({ status: 'closing' })
        .eq('channel_id', channelId)
        .in('status', ['open', 'closing'])
      if (flagError) console.error('[supabase] orphan flag failed:', flagError.message)

      // Catch the row up to the last known voucher without resending an
      // unchanged cumulative_amount (the trigger rejects non-increasing writes).
      const { error } = await supabase
        .from('sessions')
        .update({
          cumulative_amount: state.cumulativeAmount,
          voucher_count: state.voucherCount,
          last_signature: state.lastSignature,
        })
        .eq('channel_id', channelId)
        .lt('cumulative_amount', state.cumulativeAmount)
      if (error) console.error('[supabase] orphan update failed:', error.message)
    },

    onSettled: async (txHash, totalPaid, mode, payer) => {
      console.log(`[settled] mode=${mode} txHash=${txHash} totalPaid=${totalPaid}`)
      if (!supabase) return

      // `.in` so a session already flagged `closing` is closed by a clean
      // settlement; rows already `closed` stay untouched.
      const { data: closedRows, error: closeError } = await supabase
        .from('sessions')
        .update({ status: 'closed', settlement_tx_hash: txHash })
        .eq('channel_id', channelContract)
        .in('status', ['open', 'closing'])
        .select('id')
      if (closeError) console.error('[supabase] session close failed:', closeError.message)

      // Associate the close entry with the session row we just updated. If the
      // row cannot be resolved (missing or read error), skip the association
      // rather than attaching the close to an unrelated session.
      const sessionId = Array.isArray(closedRows) && closedRows.length > 0
        ? (closedRows[0] as { id?: string }).id ?? null
        : null
      if (!sessionId) {
        console.error(
          '[supabase] session close: no session row resolved for channel',
          channelContract,
        )
      }

      const { error } = await supabase.from('tx_log').insert({
        session_id: sessionId,
        tx_type: 'channel_close',
        tx_hash: txHash,
        amount: parseFloat(totalPaid),
        mode,
        network,
        provider_url: providerUrl,
        agent_address: payer,
        metadata: { settled_at: new Date().toISOString() },
      })
      if (error) console.error('[supabase] tx_log insert failed:', error.message)
    },
  }
}
