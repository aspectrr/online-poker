import { Show, createSignal } from 'solid-js'
import { A } from '@solidjs/router'
import { Logo } from '../components/Logo'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { supabase } from '../lib/supabase'

export function AuthPage() {
  const [email, setEmail] = createSignal('')
  const [sent, setSent] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [sending, setSending] = createSignal(false)
  const client = supabase()

  const submit = async (e: SubmitEvent) => {
    e.preventDefault()
    if (!client) return
    setSending(true)
    setError(null)
    const { error: err } = await client.auth.signInWithOtp({
      email: email().trim(),
      options: { shouldCreateUser: true },
    })
    setSending(false)
    if (err) setError(err.message)
    else setSent(true)
  }

  return (
    <div class="grid min-h-dvh place-items-center bg-bg px-4">
      <div class="w-full max-w-sm">
        <A href="/" class="mb-8 flex items-center justify-center gap-2.5">
          <span class="grid size-9 place-items-center rounded-btn bg-accent-tint text-accent">
            <Logo class="size-5" />
          </span>
          <span class="font-display text-lg font-bold tracking-tight text-fg">riverrats</span>
        </A>

        <div class="rounded-card border border-line bg-surface p-6">
          <Show
            when={client}
            fallback={
              <div class="text-center">
                <h1 class="font-display text-lg font-semibold text-fg">Sign-in unavailable</h1>
                <p class="mt-2 text-sm leading-relaxed text-fg-muted">
                  Supabase isn’t configured. Set <code class="rounded-small bg-surface-raised px-1.5 py-0.5 text-xs text-fg">VITE_SUPABASE_URL</code> and{' '}
                  <code class="rounded-small bg-surface-raised px-1.5 py-0.5 text-xs text-fg">VITE_SUPABASE_ANON_KEY</code>, then reload.
                </p>
              </div>
            }
          >
            <Show
              when={!sent()}
              fallback={
                <div class="text-center">
                  <span class="mx-auto grid size-12 place-items-center rounded-pill bg-accent-tint text-accent">
                    <svg aria-hidden="true" class="size-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M4 6h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z" />
                      <path d="m22 10-10 5L2 10" stroke-linejoin="round" />
                    </svg>
                  </span>
                  <h1 class="mt-4 font-display text-lg font-semibold text-fg">Check your inbox</h1>
                  <p class="mt-2 text-sm leading-relaxed text-fg-muted">
                    We sent a magic link to <span class="font-medium text-fg">{email()}</span>.
                    Open it on this device and you’ll land back in the lobby.
                  </p>
                </div>
              }
            >
              <h1 class="font-display text-lg font-semibold text-fg">Sign in to play</h1>
              <p class="mt-1 text-sm text-fg-muted">We’ll email you a one-time link. No passwords.</p>
              <form class="mt-5 flex flex-col gap-4" onSubmit={submit}>
                {/* biome-ignore lint/a11y/noLabelWithoutControl: label wraps the custom Input, which renders a real text input */}
                <label class="flex flex-col gap-1.5">
                  <span class="text-xs font-medium tracking-wide text-fg-muted uppercase">Email</span>
                  <Input
                    type="email"
                    required
                    autocomplete="email"
                    placeholder="you@example.com"
                    value={email()}
                    onInput={(e) => setEmail(e.currentTarget.value)}
                  />
                </label>
                <Show when={error()}>
                  <p role="alert" class="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                    {error()}
                  </p>
                </Show>
                <Button type="submit" disabled={sending() || !email().trim()}>
                  {sending() ? 'Sending link…' : 'Send magic link'}
                </Button>
              </form>
            </Show>
          </Show>
        </div>

        <p class="mt-6 text-center text-xs text-fg-muted">
          <A href="/" class="underline-offset-4 transition-colors hover:text-fg hover:underline">
            ← Back to lobby
          </A>
        </p>
      </div>
    </div>
  )
}
