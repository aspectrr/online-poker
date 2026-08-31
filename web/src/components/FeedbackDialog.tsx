import { createSignal, For, Show } from 'solid-js'
import { Dialog, DialogContent, DialogTrigger } from './ui/Dialog'
import { Button } from './ui/Button'
import { Field, Select } from './ui/Select'
import { submitFeedback } from '../lib/feedback'
import { cn } from '../lib/cn'

/**
 * Footer feedback widget (ASPTR-192): textarea + optional 1-5 star rating +
 * severity select. Success toast; failure inline error. No new deps.
 */
export function FeedbackDialog(props: { class?: string }) {
  const [open, setOpen] = createSignal(false)
  const [message, setMessage] = createSignal('')
  const [rating, setRating] = createSignal(0)
  const [severity, setSeverity] = createSignal('info')
  const [sending, setSending] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [toast, setToast] = createSignal(false)

  const submit = async () => {
    if (!message().trim() || sending()) return
    setSending(true)
    setError(null)
    try {
      await submitFeedback({
        message: message().trim(),
        rating: rating() || undefined,
        severity: severity() as 'info' | 'suggestion' | 'bug',
      })
      setOpen(false)
      setMessage(''); setRating(0); setSeverity('info')
      setToast(true)
      setTimeout(() => setToast(false), 3500)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <Dialog open={open()} onOpenChange={setOpen}>
        <DialogTrigger
          as={Button}
          variant="text"
          size="sm"
          class={cn('text-fg-muted hover:text-fg', props.class)}
        >
          Feedback
        </DialogTrigger>
        <DialogContent
          title="Feedback"
          description="Anything broken, confusing, or missing? Tell us."
          class="w-[min(92vw,26rem)]"
        >
          <div class="flex flex-col gap-4">
            <label class="flex flex-col gap-1.5">
              <span class="text-xs font-medium uppercase tracking-wide text-fg-muted">Message</span>
              <textarea
                rows={4}
                value={message()}
                onInput={(e) => setMessage(e.currentTarget.value)}
                placeholder="What's on your mind?"
                class="w-full resize-none rounded-btn border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-faint transition-colors duration-200 hover:border-black/20 focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
              />
            </label>

            <div class="flex items-end justify-between gap-4">
              <Field label="Rating" hint="optional" class="flex-none">
                <div class="flex items-center gap-0.5" role="radiogroup" aria-label="Rating">
                  <For each={[1, 2, 3, 4, 5]}>
                    {(n) => (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={rating() === n}
                        aria-label={`${n} star${n > 1 ? 's' : ''}`}
                        class="rounded p-0.5 transition-colors hover:bg-surface-raised"
                        onClick={() => setRating(rating() === n ? 0 : n)}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          class={cn('size-5', n <= rating() ? 'fill-marigold stroke-marigold' : 'fill-none stroke-black/30')}
                          stroke-width="1.6"
                        >
                          <path d="M12 2.5l2.95 5.98 6.6.96-4.78 4.66 1.13 6.58L12 17.57l-5.9 3.1 1.13-6.57L2.45 9.44l6.6-.96L12 2.5z" />
                        </svg>
                      </button>
                    )}
                  </For>
                </div>
              </Field>
              <Field label="Severity" class="w-40">
                <Select
                  value={severity()}
                  onChange={setSeverity}
                  options={[
                    { value: 'info', label: 'Info' },
                    { value: 'suggestion', label: 'Suggestion' },
                    { value: 'bug', label: 'Bug' },
                  ]}
                />
              </Field>
            </div>

            <Show when={error()}>
              <div class="rounded-lg bg-danger/10 px-3 py-2 text-xs font-medium text-danger">
                Couldn't send feedback — {error()}. Try again.
              </div>
            </Show>

            <div class="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
              <Button size="sm" disabled={!message().trim() || sending()} onClick={submit}>
                {sending() ? 'Sending…' : 'Send'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* success toast */}
      <Show when={toast()}>
        <div class="animate-in-pop fixed inset-x-0 bottom-6 z-[60] flex justify-center">
          <div class="rounded-full border border-line bg-surface px-4 py-1.5 text-sm font-medium text-fg shadow-lg">
            Thanks - noted.
          </div>
        </div>
      </Show>
    </>
  )
}
