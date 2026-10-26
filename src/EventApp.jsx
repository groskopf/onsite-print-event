import { useEffect, useRef, useState } from 'react'
import { Icon, Sidebar } from './shell.jsx'
import { fetchCollection } from './api.js'
import { EVENT_CODE_PATTERN, getEventPrinters, loadEvent } from './event-api.js'
import EventAttendees from './EventAttendees.jsx'
import EventCheckin from './EventCheckin.jsx'
import './event.css'

function formatDate(value) {
  const [year, month, day] = value.split('-').map(Number)
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  }).format(new Date(year, month - 1, day))
}

function eventStatus(event) {
  const today = new Date()
  const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  if (event.end_date < localDate) return 'Past event'
  return event.start_date > localDate ? 'Upcoming' : 'In progress'
}

function EventDashboard({ event }) {
  const address = [
    event.street,
    [event.zip, event.town].filter(Boolean).join(' '),
    event.country,
  ].filter(Boolean)

  return (
    <>
      <div className="editor-title-row">
        <div>
          <p className="eyebrow">Your event workspace</p>
          <h1>{event.name}</h1>
          <p className="subtitle">Everything starts with your event.</p>
        </div>
        <span className="event-status">{eventStatus(event)}</span>
      </div>
      <section className="form-card" aria-labelledby="event-details-heading">
        <div className="section-heading">
          <div>
            <h2 id="event-details-heading">Event details</h2>
            <p>A quick overview for your onsite team.</p>
          </div>
          <Icon name="calendar" />
        </div>
        <dl className="event-details">
          <div><dt>Event name</dt><dd>{event.name}</dd></div>
          <div><dt>Event code</dt><dd className="event-code">{event.code}</dd></div>
          <div><dt>Start date</dt><dd>{formatDate(event.start_date)}</dd></div>
          <div><dt>End date</dt><dd>{formatDate(event.end_date)}</dd></div>
          <div className="field-wide">
            <dt>Location</dt>
            <dd>{address.length ? address.map((line, index) =>
              <span className="event-address-line" key={index}>{line}</span>) : 'Location not set'}</dd>
          </div>
        </dl>
      </section>
      <EventPrinters eventCode={event.code} />
    </>
  )
}

function EventPrinters({ eventCode }) {
  const [printers, setPrinters] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const [bookings, allPrinters] = await Promise.all([
          fetchCollection('bookings', controller.signal),
          fetchCollection('printers', controller.signal),
        ])
        const result = getEventPrinters(eventCode, bookings, allPrinters)
        if (!controller.signal.aborted) setPrinters(result)
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(`Unable to load event printers. ${cause.message}`)
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    load()
    return () => controller.abort()
  }, [eventCode, attempt])

  function retry() {
    setError('')
    setLoading(true)
    setAttempt((value) => value + 1)
  }

  return (
    <section className="form-card event-printers" aria-labelledby="event-printers-heading" aria-busy={loading}>
      <div className="section-heading">
        <div>
          <h2 id="event-printers-heading">Printers</h2>
          <p>Printers booked for this event.</p>
        </div>
        <Icon name="printer" />
      </div>
      {loading ? <p className="list-message" role="status">Loading printers...</p> : error ? (
        <div className="load-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={retry}>Try again</button>
        </div>
      ) : printers.length === 0 ? <p className="list-message">No printers are booked for this event.</p> : (
        <ul className="event-printer-list">
          {printers.map((printer) => (
            <li key={printer.code}>
              <span className="event-icon"><Icon name="printer" /></span>
              <div className="event-printer-copy">
                <h3>{printer.description || `Printer ${printer.label}`}</h3>
                <p>{printer.code}</p>
                <ul className="event-printer-periods" aria-label="Booking periods">
                  {printer.bookings.map((booking) => <li key={booking.booking_code}>
                    {formatDate(booking.start_date)} &ndash; {formatDate(booking.end_date)}
                  </li>)}
                </ul>
              </div>
              <span className="event-id">Printer {printer.label}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default function EventApp() {
  const [code, setCode] = useState('')
  const [event, setEvent] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [activeView, setActiveView] = useState('event')
  const requestRef = useRef(null)
  const headingRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    document.title = 'Onsite Print | Event'
    return () => requestRef.current?.abort()
  }, [])

  useEffect(() => {
    if (event) headingRef.current?.focus()
  }, [event, activeView])

  async function openEvent(submitEvent) {
    submitEvent.preventDefault()
    const normalizedCode = code.trim().toUpperCase()
    setCode(normalizedCode)
    setError('')
    if (!EVENT_CODE_PATTERN.test(normalizedCode)) {
      setError('Enter a 16-character event code using letters A-Z and numbers 2-7.')
      inputRef.current?.focus()
      return
    }

    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    setLoading(true)
    try {
      setEvent(await loadEvent(normalizedCode, controller.signal))
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof TypeError
          ? 'Unable to connect. Check your connection and try again.'
          : cause.message)
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }

  function changeEvent() {
    setEvent(null)
    setCode('')
    setError('')
    setActiveView('event')
  }

  const viewLabel = { event: 'Event', attendees: 'Attendees', checkin: 'Check-in' }[activeView]

  return (
    <div className="app-shell event-shell">
      <Sidebar activeView={activeView} onNavigate={setActiveView} eventOpen={Boolean(event)} onLogout={changeEvent} />
      <main className="editor-panel" id="workspace">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Onsite Print</span><Icon name="chevron" size={13} />
            {event && <><span>{event.name}</span><Icon name="chevron" size={13} /></>}
            <strong ref={headingRef} tabIndex={-1}>{event ? viewLabel : 'Event login'}</strong>
          </div>
          <span className="event-workspace-label">Facilitator workspace</span>
        </header>
        <div className={`editor-content${event ? '' : ' event-entry-content'}`}>
          {event ? activeView === 'event' ? <EventDashboard event={event} /> : activeView === 'attendees' ? (
            <EventAttendees key={event.code} event={event} />
          ) : <EventCheckin key={event.code} event={event} /> : (
            <section className="form-card event-entry" aria-labelledby="event-entry-heading">
              <span className="event-icon"><Icon name="ticket" size={28} /></span>
              <p className="eyebrow">Welcome to your event</p>
              <h1 id="event-entry-heading">Log in to your event</h1>
              <p className="event-entry-description">Enter your event code to open your event workspace.</p>
              <form onSubmit={openEvent} aria-busy={loading}>
                <label className="field" htmlFor="event-code">
                  <span className="field-label">Event code</span>
                  <input
                    id="event-code"
                    ref={inputRef}
                    value={code}
                    onChange={(change) => { setCode(change.target.value); setError('') }}
                    placeholder="e.g. ABCDEFGH234567AB"
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    aria-describedby={`event-code-help${error ? ' event-code-error' : ''}`}
                    aria-invalid={Boolean(error)}
                    disabled={loading}
                    required
                  />
                </label>
                <p id="event-code-help" className="event-input-help">You can find this code in the event details shared by your organiser.</p>
                {error && <p className="load-error" id="event-code-error" role="alert">{error}</p>}
                <button className="primary-button" type="submit" disabled={loading}>
                  {loading ? 'Logging in...' : 'Log in'}<Icon name="chevron" size={16} />
                </button>
                <p className="event-loading" role="status">{loading ? 'Looking up your event...' : ''}</p>
              </form>
              <p className="event-entry-footnote">Only have access to your event code? That&apos;s all you need to open the overview.</p>
            </section>
          )}
        </div>
      </main>
    </div>
  )
}
