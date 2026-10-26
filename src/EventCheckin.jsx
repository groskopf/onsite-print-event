import { useEffect, useRef, useState } from 'react'
import { Icon } from './shell.jsx'
import { fetchCollection } from './api.js'
import { AttendeeCells, AttendeeSearch, SortableHeadings } from './attendee-list.jsx'
import { fullName, nextSort, useFitToWindow } from './attendee-list-utils.js'
import {
  activeBooking, createNametag, filterAttendees, getEventPrinters, loadAttendees, sortAttendees,
} from './event-api.js'

const printerName = (printer) => `Printer ${printer.label}`
const storageKey = (eventCode) => `onsite-print:checkin-printer:${eventCode}`

function readStoredPrinter(eventCode) {
  try {
    return window.localStorage.getItem(storageKey(eventCode))
  } catch {
    return null
  }
}

function storePrinter(eventCode, printerCode) {
  try {
    if (printerCode) window.localStorage.setItem(storageKey(eventCode), printerCode)
    else window.localStorage.removeItem(storageKey(eventCode))
  } catch {
    // Remembering the printer is a convenience; private browsing may block storage.
  }
}

function PrinterPicker({ printers, selectedCode, onSelect }) {
  return (
    <ul className="event-printer-list checkin-printer-list">
      {printers.map((printer) => {
        const booking = activeBooking(printer)
        return (
          <li key={printer.code} className={printer.code === selectedCode ? 'selected' : undefined}>
            <span className="event-icon"><Icon name="printer" /></span>
            <div className="event-printer-copy">
              <h3>{printer.description || printerName(printer)}</h3>
              <p>{booking ? printer.code : 'Not booked for today'}</p>
            </div>
            <span className="event-id">{printerName(printer)}</span>
            <button
              className={printer.code === selectedCode ? 'primary-button' : 'secondary-button'}
              type="button"
              disabled={!booking}
              aria-pressed={printer.code === selectedCode}
              aria-label={`Use ${printerName(printer)}`}
              onClick={() => onSelect(printer.code)}
            >
              {printer.code === selectedCode ? <><Icon name="check" size={16} />Selected</> : 'Use printer'}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

export default function EventCheckin({ event }) {
  const [printers, setPrinters] = useState([])
  const [attendees, setAttendees] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [printerCode, setPrinterCode] = useState(() => readStoredPrinter(event.code))
  const [choosing, setChoosing] = useState(false)
  const [sort, setSort] = useState({ property: 'last_name', direction: 'ascending' })
  const [search, setSearch] = useState('')
  const [printing, setPrinting] = useState(() => new Set())
  const [printed, setPrinted] = useState(() => new Map())
  const [notice, setNotice] = useState('')
  const [printError, setPrintError] = useState('')
  const listScrollRef = useRef(null)
  const searchRef = useRef(null)
  const controllersRef = useRef(new Set())

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const [bookings, allPrinters, eventAttendees] = await Promise.all([
          fetchCollection('bookings', controller.signal),
          fetchCollection('printers', controller.signal),
          loadAttendees(event.code, controller.signal),
        ])
        if (controller.signal.aborted) return
        setPrinters(getEventPrinters(event.code, bookings, allPrinters))
        setAttendees(eventAttendees)
      } catch (cause) {
        if (!controller.signal.aborted) setError(`Unable to load check-in. ${cause.message}`)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    load()
    return () => controller.abort()
  }, [event.code, attempt])

  useEffect(() => {
    const controllers = controllersRef.current
    return () => controllers.forEach((controller) => controller.abort())
  }, [])

  const printer = printers.find((item) => item.code === printerCode) ?? null
  const booking = activeBooking(printer)
  const ready = !loading && !error && Boolean(booking) && !choosing

  function selectPrinter(code) {
    setPrinterCode(code)
    storePrinter(event.code, code)
    setChoosing(false)
    setNotice('')
    setPrintError('')
  }

  async function print(attendee) {
    const controller = new AbortController()
    controllersRef.current.add(controller)
    setNotice('')
    setPrintError('')
    setPrinting((current) => new Set(current).add(attendee.code))
    try {
      await createNametag(event.code, booking.booking_code, attendee, controller.signal)
      setPrinted((current) => new Map(current).set(attendee.code, (current.get(attendee.code) ?? 0) + 1))
      setNotice(`Name tag for ${fullName(attendee)} was sent to ${printerName(printer)}.`)
    } catch (cause) {
      if (!controller.signal.aborted) setPrintError(`${fullName(attendee)}: ${cause.message}`)
    } finally {
      controllersRef.current.delete(controller)
      if (!controller.signal.aborted) {
        setPrinting((current) => {
          const next = new Set(current)
          next.delete(attendee.code)
          return next
        })
      }
    }
  }

  const visibleAttendees = filterAttendees(sortAttendees(attendees, sort.property, sort.direction), search)
  const filtering = visibleAttendees.length !== attendees.length
  useFitToWindow(listScrollRef, ready && visibleAttendees.length > 0)

  useEffect(() => {
    if (ready) searchRef.current?.querySelector('input')?.focus()
  }, [ready])

  return (
    <>
      <div className="editor-title-row">
        <div>
          <p className="eyebrow">{event.name}</p>
          <h1>Check-in</h1>
          <p className="subtitle">
            {ready ? `Name tags print on ${printerName(printer)}.` : 'Choose the printer for this check-in desk.'}
          </p>
        </div>
        {ready && (
          <button className="secondary-button" type="button" onClick={() => setChoosing(true)}>
            <Icon name="printer" size={16} />Change printer
          </button>
        )}
      </div>
      {loading ? <p className="list-message" role="status">Loading check-in...</p> : error ? (
        <div className="load-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => {
            setError('')
            setLoading(true)
            setAttempt((value) => value + 1)
          }}>Try again</button>
        </div>
      ) : !ready ? (
        <section className="form-card" aria-labelledby="checkin-printer-heading">
          <div className="section-heading">
            <div>
              <h2 id="checkin-printer-heading">Select printer</h2>
              <p>Name tags for this desk are printed on the selected printer.</p>
            </div>
            <Icon name="printer" />
          </div>
          {printers.length === 0 ? <p className="list-message">No printers are booked for this event.</p> : <>
            {printer && !booking && <p className="load-error" role="alert">
              {printerName(printer)} is not booked for today. Choose another printer.
            </p>}
            <PrinterPicker printers={printers} selectedCode={booking ? printerCode : null} onSelect={selectPrinter} />
            {choosing && booking && (
              <div className="form-actions">
                <button className="secondary-button" type="button" onClick={() => setChoosing(false)}>Cancel</button>
              </div>
            )}
          </>}
        </section>
      ) : (
        <>
          {notice && <p role="status" className="subtitle attendee-notice">{notice}</p>}
          {printError && <div className="load-error action-error" role="alert">{printError}</div>}
          <section className="form-card" aria-labelledby="checkin-list-heading">
            <div className="section-heading">
              <div>
                <h2 id="checkin-list-heading">Attendees</h2>
                <p>
                  {filtering && `${visibleAttendees.length} of `}
                  {attendees.length} {attendees.length === 1 ? 'attendee' : 'attendees'}{filtering && ' shown'}
                </p>
              </div>
              <Icon name="people" />
            </div>
            {attendees.length === 0 ? (
              <p className="list-message">No attendees have been registered for this event yet.</p>
            ) : <>
              <div ref={searchRef}>
                <AttendeeSearch value={search} onChange={setSearch} controls="checkin-list" />
              </div>
              {visibleAttendees.length === 0 ? (
                <p className="list-message" role="status">No attendees match “{search.trim()}”.</p>
              ) : (
                <div className="attendee-table-scroll attendee-list-scroll" ref={listScrollRef} tabIndex={0} aria-label="Attendee list, scrollable" id="checkin-list">
                  <table className="attendee-table">
                    <thead>
                      <tr>
                        <td className="attendee-select-cell"><span className="sr-only">Print</span></td>
                        <SortableHeadings sort={sort} onSort={(property) => setSort((current) => nextSort(current, property))} />
                      </tr>
                    </thead>
                    <tbody>
                      {visibleAttendees.map((attendee) => {
                        const busy = printing.has(attendee.code)
                        const count = printed.get(attendee.code) ?? 0
                        return (
                          <tr key={attendee.code} className={count ? 'printed' : undefined}>
                            <td className="attendee-select-cell">
                              <button
                                className="secondary-button checkin-print-button"
                                type="button"
                                aria-label={`Print name tag for ${fullName(attendee)}${count ? ` (printed ${count === 1 ? 'once' : `${count} times`})` : ''}`}
                                title={busy ? 'Printing...' : count ? 'Print again' : 'Print name tag'}
                                aria-busy={busy}
                                disabled={busy}
                                onClick={() => print(attendee)}
                              >
                                <Icon name={count && !busy ? 'check' : 'printer'} size={16} />
                              </button>
                            </td>
                            <AttendeeCells attendee={attendee} />
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>}
          </section>
        </>
      )}
    </>
  )
}
