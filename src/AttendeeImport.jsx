import { useEffect, useRef, useState } from 'react'
import { Icon } from './shell.jsx'
import {
  ATTENDEE_FIELDS, AttendeeExistsError, assignCsvColumn, createAttendee, csvRowsToDrafts, guessCsvMapping,
} from './event-api.js'

const PREVIEW_ROWS = 5

function DuplicatePrompt({ item, existing, onChoose }) {
  const firstButtonRef = useRef(null)
  useEffect(() => firstButtonRef.current?.focus(), [item])
  const { first_name: firstName, last_name: lastName, email } = item.draft
  const same = (key) => (existing?.[key] ?? '').trim().toLowerCase() === (item.draft[key] ?? '').trim().toLowerCase()
  return (
    <div className="attendee-duplicate" role="alertdialog" aria-labelledby="duplicate-heading" aria-describedby="duplicate-text">
      <h3 id="duplicate-heading">Possible duplicate in row {item.row}</h3>
      <p id="duplicate-text">
        {firstName} {lastName}{email ? ` (${email})` : ' without an email address'} is already registered for this event.
        Do you want to create a duplicate attendee?
      </p>
      <div className="attendee-duplicate-compare">
        <table>
          <caption className="sr-only">Registered attendee compared with row {item.row}</caption>
          <thead>
            <tr>
              <th scope="col">Property</th>
              <th scope="col">Already registered</th>
              <th scope="col">Row {item.row} in the file</th>
            </tr>
          </thead>
          <tbody>
            {ATTENDEE_FIELDS.map(([key, label]) => (
              <tr key={key} className={same(key) ? undefined : 'different'}>
                <th scope="row">
                  {label}
                  {!same(key) && <span className="sr-only"> (different)</span>}
                </th>
                <td>{existing ? existing[key] || <span className="empty">-</span> : <span className="empty">Unknown</span>}</td>
                <td>{item.draft[key] || <span className="empty">-</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="editor-actions">
        <button className="primary-button" type="button" ref={firstButtonRef} onClick={() => onChoose('create')}>
          Create duplicate
        </button>
        <button className="secondary-button" type="button" onClick={() => onChoose('create-all')}>
          Create all duplicates
        </button>
        <button className="secondary-button" type="button" onClick={() => onChoose('skip')}>Skip</button>
        <button className="secondary-button" type="button" onClick={() => onChoose('skip-all')}>
          Skip all duplicates
        </button>
        <button className="secondary-button" type="button" onClick={() => onChoose('stop')}>Stop import</button>
      </div>
    </div>
  )
}

export default function AttendeeImport({ eventCode, fileName, csv, onCreated, onClose }) {
  const [mapping, setMapping] = useState(() => guessCsvMapping(csv.rows[0]))
  const [skipFirstRow, setSkipFirstRow] = useState(() =>
    Object.values(guessCsvMapping(csv.rows[0])).some((column) => column != null))
  const [status, setStatus] = useState('mapping')
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [duplicate, setDuplicate] = useState(null)
  const [result, setResult] = useState(null)
  const [stopping, setStopping] = useState(false)
  const controllerRef = useRef(null)
  const stopRef = useRef(false)
  const headingRef = useRef(null)
  const summaryRef = useRef(null)

  useEffect(() => {
    headingRef.current?.focus()
    return () => controllerRef.current?.abort()
  }, [])

  useEffect(() => {
    if (status === 'done') summaryRef.current?.focus()
  }, [status])

  const columnProperty = (column) => Object.keys(mapping).find((key) => mapping[key] === column) ?? ''
  const items = csvRowsToDrafts(csv.rows, mapping, skipFirstRow)
  const missingRequired = ATTENDEE_FIELDS.filter(([key, , , required]) => required && mapping[key] == null)

  function askDuplicate(item, existing) {
    return new Promise((resolve) => setDuplicate({ item, existing, resolve }))
  }

  async function runImport() {
    const controller = new AbortController()
    controllerRef.current = controller
    const summary = { created: 0, duplicatesCreated: 0, skipped: 0, failures: [], stopped: false }
    let duplicatePolicy = null
    setStatus('importing')
    setProgress({ done: 0, total: items.length })
    for (const [index, item] of items.entries()) {
      if (controller.signal.aborted) return
      if (stopRef.current) {
        summary.stopped = true
        break
      }
      if (item.error) {
        summary.failures.push({ row: item.row, message: item.error })
      } else {
        try {
          let attendee
          try {
            attendee = await createAttendee(eventCode, item.draft, controller.signal)
          } catch (cause) {
            if (!(cause instanceof AttendeeExistsError)) throw cause
            let choice = duplicatePolicy
            if (!choice) {
              choice = await askDuplicate(item, cause.existing)
              setDuplicate(null)
              if (choice === 'create-all') duplicatePolicy = choice = 'create'
              if (choice === 'skip-all') duplicatePolicy = choice = 'skip'
            }
            if (choice === 'stop') {
              summary.stopped = true
              break
            }
            if (choice === 'skip') {
              summary.skipped += 1
            } else {
              attendee = await createAttendee(eventCode, item.draft, controller.signal, { allowDuplicate: true })
              summary.duplicatesCreated += 1
            }
          }
          if (attendee) {
            summary.created += 1
            onCreated(attendee)
          }
        } catch (cause) {
          if (controller.signal.aborted) return
          summary.failures.push({ row: item.row, message: cause.message })
        }
      }
      setProgress({ done: index + 1, total: items.length })
    }
    controllerRef.current = null
    setResult(summary)
    setStatus('done')
  }

  const previewRows = csv.rows.slice(0, PREVIEW_ROWS)

  return (
    <section className="form-card attendee-import" aria-labelledby="attendee-import-heading">
      <div className="section-heading">
        <div>
          <h2 id="attendee-import-heading" tabIndex={-1} ref={headingRef}>Import attendees</h2>
          <p>{fileName} - {csv.rows.length} {csv.rows.length === 1 ? 'row' : 'rows'}, {csv.columns} {csv.columns === 1 ? 'column' : 'columns'}</p>
        </div>
        <Icon name="people" />
      </div>

      {status === 'mapping' && (
        <>
          <p className="attendee-import-help">
            Choose the attendee property for each column. Choosing a property that is already used by another column
            swaps the two columns.
          </p>
          <label className="attendee-checkbox">
            <input type="checkbox" checked={skipFirstRow} onChange={(changeEvent) => setSkipFirstRow(changeEvent.target.checked)} />
            Skip first row (column headings)
          </label>
          <div className="attendee-table-scroll">
            <table className="attendee-table attendee-preview">
              <caption className="attendee-import-subheading">
                Preview of the first {Math.min(PREVIEW_ROWS, csv.rows.length)} rows
              </caption>
              <thead>
                <tr>
                  <th scope="col">Row</th>
                  {csv.rows[0].map((heading, index) => {
                    const property = columnProperty(index)
                    return (
                      <th scope="col" key={index} className={property ? 'mapped' : undefined}>
                        <select
                          className="attendee-column-select"
                          aria-label={`Attendee property for column ${index + 1}${skipFirstRow && heading.trim() ? ` (${heading.trim()})` : ''}`}
                          value={property}
                          onChange={(changeEvent) =>
                            setMapping(assignCsvColumn(mapping, index, changeEvent.target.value || null))}
                        >
                          <option value="">Do not import</option>
                          {ATTENDEE_FIELDS.map(([key, label, , required]) => (
                            <option key={key} value={key}>{label}{required ? ' *' : ''}</option>
                          ))}
                        </select>
                        <span className="attendee-column-number">Column {index + 1}</span>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((values, rowIndex) => {
                  const skipped = skipFirstRow && rowIndex === 0
                  return (
                    <tr key={rowIndex} className={skipped ? 'skipped' : undefined}>
                      <th scope="row">{rowIndex + 1}{skipped ? ' (skipped)' : ''}</th>
                      {values.map((value, index) => (
                        <td key={index} className={columnProperty(index) ? undefined : 'unmapped'}>{value || '-'}</td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {missingRequired.length > 0 && (
            <p className="subtitle">Choose a column for {missingRequired.map(([, label]) => label.toLowerCase()).join(' and ')}.</p>
          )}
          {items.length === 0 && <p className="subtitle">There are no rows to import.</p>}
          <div className="editor-actions">
            <button
              className="primary-button"
              type="button"
              disabled={missingRequired.length > 0 || items.length === 0}
              onClick={runImport}
            >
              <Icon name="check" size={16} />
              Import {items.length} {items.length === 1 ? 'attendee' : 'attendees'}
            </button>
            <button className="secondary-button" type="button" onClick={onClose}>Cancel</button>
          </div>
        </>
      )}

      {status === 'importing' && (
        <>
          <p role="status" className="list-message">Importing {progress.done} of {progress.total}...</p>
          <progress className="attendee-progress" max={progress.total} value={progress.done} />
          {duplicate ? <DuplicatePrompt item={duplicate.item} existing={duplicate.existing} onChoose={duplicate.resolve} /> : (
            <div className="editor-actions">
              <button className="secondary-button" type="button" disabled={stopping} onClick={() => {
                stopRef.current = true
                setStopping(true)
              }}>{stopping ? 'Stopping...' : 'Stop import'}</button>
            </div>
          )}
        </>
      )}

      {status === 'done' && result && (
        <div className="attendee-import-result" tabIndex={-1} ref={summaryRef} role="status">
          <p>
            {result.stopped ? 'Import stopped. ' : 'Import finished. '}
            {result.created} {result.created === 1 ? 'attendee was' : 'attendees were'} added
            {result.duplicatesCreated ? ` (${result.duplicatesCreated} as duplicates)` : ''}.
            {result.skipped ? ` ${result.skipped} ${result.skipped === 1 ? 'duplicate was' : 'duplicates were'} skipped.` : ''}
            {result.failures.length ? ` ${result.failures.length} ${result.failures.length === 1 ? 'row' : 'rows'} could not be imported.` : ''}
          </p>
          {result.failures.length > 0 && (
            <ul className="attendee-import-failures">
              {result.failures.map(({ row, message }) => <li key={row}>Row {row}: {message}</li>)}
            </ul>
          )}
          <div className="editor-actions">
            <button className="primary-button" type="button" onClick={onClose}>Done</button>
          </div>
        </div>
      )}
    </section>
  )
}
