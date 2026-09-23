/**
 * Parallel slots and a bounded wait queue, the way Ollama schedules requests
 * with OLLAMA_NUM_PARALLEL and OLLAMA_MAX_QUEUE: at most `capacity` requests
 * generate at once, up to `maxQueue` wait (first come, first served), and the
 * rest are turned away with 503.
 */

export class QueueFullError extends Error {
  constructor() {
    super('server busy, please try again.  maximum pending requests exceeded')
  }
}

export class AbortedError extends Error {
  constructor() {
    super('request aborted')
  }
}

interface Waiter {
  id: number
  resolve: (slot: number) => void
  reject: (e: Error) => void
}

export class Scheduler {
  private capacity: number
  private maxQueue: number
  /** slot index -> request id */
  private busy = new Map<number, number>()
  private waiting: Waiter[] = []

  constructor(capacity: number, maxQueue: number) {
    this.capacity = Math.max(1, capacity)
    this.maxQueue = Math.max(0, maxQueue)
  }

  resize(capacity: number, maxQueue: number): void {
    this.capacity = Math.max(1, capacity)
    this.maxQueue = Math.max(0, maxQueue)
    this.drain()
  }

  private freeSlot(): number {
    for (let i = 0; i < this.capacity; i++) if (!this.busy.has(i)) return i
    return -1
  }

  acquire(id: number, signal?: AbortSignal): Promise<number> {
    if (signal?.aborted) return Promise.reject(new AbortedError())
    const slot = this.waiting.length === 0 ? this.freeSlot() : -1
    if (slot >= 0) {
      this.busy.set(slot, id)
      return Promise.resolve(slot)
    }
    if (this.waiting.length >= this.maxQueue) return Promise.reject(new QueueFullError())
    return new Promise<number>((resolve, reject) => {
      const waiter: Waiter = { id, resolve, reject }
      this.waiting.push(waiter)
      signal?.addEventListener(
        'abort',
        () => {
          const i = this.waiting.indexOf(waiter)
          if (i >= 0) {
            this.waiting.splice(i, 1)
            reject(new AbortedError())
          }
        },
        { once: true },
      )
    })
  }

  release(slot: number): void {
    this.busy.delete(slot)
    this.drain()
  }

  private drain(): void {
    for (;;) {
      const slot = this.freeSlot()
      const next = slot >= 0 ? this.waiting.shift() : undefined
      if (!next) return
      this.busy.set(slot, next.id)
      next.resolve(slot)
    }
  }

  /** Slots for display: every configured slot, plus any busy slot above a lowered capacity. */
  slots(): { index: number; requestId: number | null }[] {
    const top = Math.max(this.capacity, ...[...this.busy.keys()].map((k) => k + 1))
    return Array.from({ length: top }, (_, index) => ({
      index,
      requestId: this.busy.get(index) ?? null,
    }))
  }

  queue(): number[] {
    return this.waiting.map((w) => w.id)
  }

  get busyCount(): number {
    return this.busy.size
  }
}
