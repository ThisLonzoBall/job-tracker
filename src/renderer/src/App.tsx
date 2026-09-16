import { useEffect, useState, type JSX } from 'react'
import type { ApplicationWithStage, AppStatus } from '../../preload'

const STAGE_LABEL: Record<string, string> = {
  applied: 'Applied',
  ack: 'Acknowledged',
  assessment: 'Assessment',
  screen: 'Phone screen',
  onsite: 'Onsite',
  offer: 'Offer',
  rejected: 'Rejected',
  ghosted: 'Ghosted'
}

export default function App(): JSX.Element {
  const [applications, setApplications] = useState<ApplicationWithStage[] | null>(null)
  const [status, setStatus] = useState<AppStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([window.tracker.listApplications(), window.tracker.getStatus()])
      .then(([apps, s]) => {
        setApplications(apps)
        setStatus(s)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  return (
    <main>
      <header>
        <h1>Job Tracker</h1>
        <p className="status">
          {status?.lastSyncedAt
            ? `Last synced ${new Date(status.lastSyncedAt).toLocaleString()}`
            : 'Not synced yet — Gmail sync arrives in a later stage'}
        </p>
      </header>

      {error && <p className="error">Could not load applications: {error}</p>}

      {applications === null && !error && <p className="muted">Loading…</p>}

      {applications?.length === 0 && (
        <section className="empty">
          <h2>No applications yet</h2>
          <p>
            The database is ready. Applications will appear here once email sync and the browser
            extension are connected.
          </p>
          {status && <code>{status.dbPath}</code>}
        </section>
      )}

      {applications && applications.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Company</th>
              <th>Role</th>
              <th>Stage</th>
              <th>Last activity</th>
            </tr>
          </thead>
          <tbody>
            {applications.map((a) => (
              <tr key={a.id}>
                <td>{a.company}</td>
                <td>{a.role ?? '—'}</td>
                <td>
                  <span className={`stage stage-${a.stage ?? 'none'}`}>
                    {a.stage ? STAGE_LABEL[a.stage] : '—'}
                  </span>
                </td>
                <td>{new Date(a.last_activity_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  )
}
