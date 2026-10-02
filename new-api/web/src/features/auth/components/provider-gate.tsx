import { useState } from 'react'

const PROVIDERS = [{ id: 'antigravity', label: 'Antigravity' }]

type Props = { onDone: () => void | Promise<void> }

export function ProviderGate({ onDone }: Props) {
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pending, setPending] = useState<{ provider: string; authUrl: string; state?: string } | null>(null)
  const [callbackUrl, setCallbackUrl] = useState('')

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  const start = async () => {
    setBusy(true)
    setError('')
    try {
      const provider = selected[0]
      const r = await fetch('/api/bridge/oauth/start', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      })
      if (!r.ok) throw new Error('Failed to start provider OAuth (HTTP ' + r.status + ')')
      const data = await r.json() // ASSUMPTION: { authUrl, state }
      setPending({ provider, authUrl: data.authUrl, state: data.state })
      window.open(data.authUrl, '_blank', 'noopener') // popup keeps this route alive
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const finish = async () => {
    if (!pending) return
    setBusy(true)
    setError('')
    try {
      const r = await fetch('/api/bridge/oauth/finish', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        // ASSUMPTION: field names, adjust to your bridge handler
        body: JSON.stringify({ provider: pending.provider, callbackUrl, state: pending.state }),
      })
      if (!r.ok) throw new Error('Provider connection failed (HTTP ' + r.status + ')')
      await onDone() // only now do we log in + navigate
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className='mx-auto flex max-w-md flex-col gap-4 p-8'>
      <h1 className='text-xl font-semibold'>Connect to AI Providers</h1>

      {!pending ? (
        <>
          <p>Choose the AI providers you want to connect.</p>
          {PROVIDERS.map((p) => (
            <label key={p.id} className='flex items-center gap-2'>
              <input type='checkbox' checked={selected.includes(p.id)} onChange={() => toggle(p.id)} />
              {p.label}
            </label>
          ))}
          <button disabled={busy || selected.length === 0} onClick={start}>
            Continue
          </button>
        </>
      ) : (
        <>
          <p>Finish signing in with the provider in the new tab, then paste the final callback URL here.</p>
          <input
            value={callbackUrl}
            onChange={(e) => setCallbackUrl(e.target.value)}
            placeholder='Paste callback URL'
          />
          <button disabled={busy || !callbackUrl} onClick={finish}>
            Finish
          </button>
        </>
      )}

      {error && <p className='text-red-500'>{error}</p>}
    </div>
  )
}