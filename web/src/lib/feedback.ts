/**
 * Feedback submit (ASPTR-192): POST /token for a one-shot token, then
 * POST /feedback with x-feedback-token. Host overridable via VITE_FEEDBACK_URL.
 */
const FEEDBACK_URL: string = import.meta.env.VITE_FEEDBACK_URL ?? 'https://aspectrr-feedback.fly.dev'

export type FeedbackPayload = {
  message: string
  rating?: number
  severity: 'info' | 'suggestion' | 'bug'
}

export async function submitFeedback(p: FeedbackPayload): Promise<{ id: number }> {
  const tokenRes = await fetch(`${FEEDBACK_URL}/token`, { method: 'POST' })
  if (!tokenRes.ok) throw new Error(`token request failed: ${tokenRes.status}`)
  const { token } = (await tokenRes.json()) as { token: string }

  const res = await fetch(`${FEEDBACK_URL}/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-feedback-token': token },
    body: JSON.stringify({ source: 'online-poker', message: p.message, rating: p.rating, severity: p.severity }),
  })
  if (!res.ok) throw new Error(`feedback submit failed: ${res.status}`)
  return res.json() as Promise<{ id: number }>
}
