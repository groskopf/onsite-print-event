import { useEffect, useRef, useState } from 'react'
import { Icon } from './shell.jsx'
import AttendeeImport from './AttendeeImport.jsx'
import { AttendeeCells, AttendeeSearch, SortableHeadings } from './attendee-list.jsx'
import { attendeeColumns, fullName, nextSort, useFitToWindow } from './attendee-list-utils.js'
import {
  ATTENDEE_FIELDS, AttendeeExistsError, createAttendee, decodeCsvBytes, deleteAttendee, filterAttendees, loadAttendees,
  parseCsv,
  sortAttendees, updateAttendee,
} from './event-api.js'

function AttendeeDeleteConfirm({ eventCode, attendees, onDeleted, onClose }) {
  const [deleting, setDeleting] = useState(false)
  const [progress, setProgress] = useState(0)
  const controllerRef = useRef(null)
  const cancelRef = useRef(null)
  const count = attendees.length
  const noun = count === 1 ? 'attendee' : 'attendees'

  useEffect(() => {
    cancelRef.current?.focus()
    return () => controllerRef.current?.abort()
  }, [])

  async function confirm() {
    const controller = new AbortController()
    controllerRef.current = controller
    setDeleting(true)
    const deleted = []
    const failures = []
    for (const attendee of attendees) {
      try {
        await deleteAttendee(eventCode, attendee.code, controller.signal)
        deleted.push(attendee)
      } catch (cause) {
        if (controller.signal.aborted) return
        failures.push({ attendee, message: cause.message })
      }
      setProgress((value) => value + 1)
    }
    controllerRef.current = null
    onDeleted(deleted, failures)
  }

  return (
    <section
      className="form-card attendee-delete"
      role="alertdialog"
      aria-labelledby="attendee-delete-heading"
      aria-describedby="attendee-delete-text"
    >
      <div className="section-heading">
        <div>
          <h2 id="attendee-delete-heading">Delete {count === 1 ? fullName(attendees[0]) : `${count} attendees`}?</h2>
          <p id="attendee-delete-text">
            The following {count === 1 ? 'attendee' : `${count} attendees`} will be permanently deleted. This cannot be undone.
          </p>
        </div>
        <Icon name="trash" />
      </div>
      <div className="attendee-table-scroll attendee-delete-list">
        <table className="attendee-table">
          <caption className="sr-only">{noun} to delete</caption>
          <thead>
            <tr>
              {attendeeColumns.map(([key, label]) => <th scope="col" key={key}>{label}</th>)}
            </tr>
          </thead>
          <tbody>
            {attendees.map((attendee) => (
              <tr key={attendee.code}>
                <th scope="row">{fullName(attendee)}</th>
                {ATTENDEE_FIELDS.slice(2).map(([key]) => <td key={key}>{attendee[key] || '-'}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {deleting && <p className="subtitle" role="status">Deleting {progress} of {count}...</p>}
      <div className="editor-actions">
        <button className="danger-button" type="button" disabled={deleting} onClick={confirm}>
          <Icon name="trash" size={16} />
          {deleting ? 'Deleting...' : `Delete ${count} ${noun}`}
        </button>
        <button className="secondary-button" type="button" ref={cancelRef} disabled={deleting} onClick={onClose}>
          Cancel
        </button>
      </div>
    </section>
  )
}

function AttendeeForm({ eventCode, attendee, onSaved, onClose }) {
  const [draft, setDraft] = useState(() =>
    Object.fromEntries(ATTENDEE_FIELDS.map(([key]) => [key, attendee?.[key] ?? ''])))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [duplicate, setDuplicate] = useState(false)
  const requestRef = useRef(null)
  const firstNameRef = useRef(null)
  const duplicateButtonRef = useRef(null)

  useEffect(() => {
    if (duplicate) duplicateButtonRef.current?.focus()
  }, [duplicate])

  useEffect(() => {
    firstNameRef.current?.focus()
    return () => requestRef.current?.abort()
  }, [])

  async function submit(submitEvent, allowDuplicate = false) {
    submitEvent.preventDefault()
    if (requestRef.current) return
    const controller = new AbortController()
    requestRef.current = controller
    setSaving(true)
    setError('')
    setDuplicate(false)
    try {
      const saved = attendee
        ? await updateAttendee(eventCode, attendee.code, draft, controller.signal)
        : await createAttendee(eventCode, draft, controller.signal, { allowDuplicate })
      if (!controller.signal.aborted) onSaved(saved)
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause.message)
        setDuplicate(cause instanceof AttendeeExistsError)
      }
    } finally {
      if (!controller.signal.aborted) {
        requestRef.current = null
        setSaving(false)
      }
    }
  }

  return (
    <form className="form-card attendee-form" onSubmit={submit} aria-labelledby="attendee-form-heading">
      <div className="section-heading">
        <div>
          <h2 id="attendee-form-heading">{attendee ? 'Edit attendee' : 'New attendee'}</h2>
          <p>First name and last name are required.</p>
        </div>
      </div>
      <fieldset className="attendee-fields" disabled={saving}>
        {ATTENDEE_FIELDS.map(([key, label, type, required]) => (
          <label className="field" key={key}>
            <span className="field-label">{label}{required ? ' *' : ''}</span>
            <input
              ref={key === 'first_name' ? firstNameRef : undefined}
              name={key}
              type={type}
              required={required}
              value={draft[key]}
              onChange={(changeEvent) => {
                setDraft({ ...draft, [key]: changeEvent.target.value })
                setDuplicate(false)
              }}
            />
          </label>
        ))}
      </fieldset>
      {error && (
        <div className="load-error action-error" role="alert">
          <span>{error}{duplicate ? ' Do you want to add a duplicate attendee?' : ''}</span>
          {duplicate && (
            <button type="button" ref={duplicateButtonRef} disabled={saving} onClick={(clickEvent) => submit(clickEvent, true)}>
              Add duplicate
            </button>
          )}
        </div>
      )}
      <div className="editor-actions">
        <button className="primary-button" type="submit" disabled={saving}>
          <Icon name={attendee ? 'check' : 'plus'} size={16} />
          {attendee ? saving ? 'Saving changes...' : 'Save changes' : saving ? 'Adding attendee...' : 'Add attendee'}
        </button>
        <button className="secondary-button" type="button" disabled={saving} onClick={onClose}>Cancel</button>
      </div>
    </form>
  )
}

export default function EventAttendees({ event }) {
  const [attendees, setAttendees] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(null)
  const [notice, setNotice] = useState('')
  const [sort, setSort] = useState({ property: 'last_name', direction: 'ascending' })
  const [importFile, setImportFile] = useState(null)
  const [importError, setImportError] = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleteError, setDeleteError] = useState('')
  const [search, setSearch] = useState('')
  const buttonRef = useRef(null)
  const importButtonRef = useRef(null)
  const fileInputRef = useRef(null)
  const selectAllRef = useRef(null)
  const listHeadingRef = useRef(null)
  const listScrollRef = useRef(null)
  const returnFocusRef = useRef(null)
  const restoreFocusRef = useRef(false)

  useEffect(() => {
    if (!adding && !editing && !importFile && !confirmDelete && restoreFocusRef.current) {
      const target = returnFocusRef.current
      // The trigger may have been removed, e.g. the row of a deleted attendee.
      ;(target?.isConnected && !target.disabled ? target : listHeadingRef.current)?.focus()
      restoreFocusRef.current = false
    }
  }, [adding, editing, importFile, confirmDelete])

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const result = await loadAttendees(event.code, controller.signal)
        if (!controller.signal.aborted) setAttendees(result)
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause.message)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    load()
    return () => controller.abort()
  }, [event.code, attempt])

  function closeForm() {
    restoreFocusRef.current = true
    setAdding(false)
    setEditing(null)
    setImportFile(null)
    setConfirmDelete(null)
  }

  function startDelete(targets, trigger) {
    returnFocusRef.current = trigger
    setNotice('')
    setImportError('')
    setDeleteError('')
    setConfirmDelete(targets)
  }

  function finishDelete(deleted, failures) {
    const deletedCodes = new Set(deleted.map((attendee) => attendee.code))
    setAttendees((current) => current.filter((attendee) => !deletedCodes.has(attendee.code)))
    setSelected((current) => new Set([...current].filter((code) => !deletedCodes.has(code))))
    if (deleted.length) {
      setNotice(deleted.length === 1
        ? `${fullName(deleted[0])} was deleted.`
        : `${deleted.length} attendees were deleted.`)
    }
    if (failures.length) {
      setDeleteError(failures.map(({ attendee, message }) => `${fullName(attendee)}: ${message}`).join(' '))
    }
    closeForm()
  }

  function toggleSelected(code) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  async function chooseFile(changeEvent) {
    const file = changeEvent.target.files?.[0]
    changeEvent.target.value = ''
    if (!file) return
    setNotice('')
    setImportError('')
    setDeleteError('')
    try {
      const csv = parseCsv(decodeCsvBytes(await file.arrayBuffer()))
      returnFocusRef.current = importButtonRef.current
      setImportFile({ name: file.name, csv })
    } catch (cause) {
      setImportError(`${file.name} could not be read as a CSV file. ${cause.message}`)
    }
  }

  const sortedAttendees = sortAttendees(attendees, sort.property, sort.direction)
  const visibleAttendees = filterAttendees(sortedAttendees, search)
  const filtering = visibleAttendees.length !== attendees.length
  const selectedAttendees = sortedAttendees.filter((attendee) => selected.has(attendee.code))
  const visibleSelected = visibleAttendees.filter((attendee) => selected.has(attendee.code)).length
  const allSelected = visibleAttendees.length > 0 && visibleSelected === visibleAttendees.length
  const someSelected = visibleSelected > 0 && !allSelected
  const busy = loading || Boolean(error) || adding || Boolean(editing) || Boolean(importFile) || Boolean(confirmDelete)
  const rowBusy = adding || Boolean(editing) || Boolean(importFile) || Boolean(confirmDelete)

  const hasList = !loading && !error && visibleAttendees.length > 0

  useFitToWindow(listScrollRef, hasList)

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected
  })

  return (
    <>
      <div className="editor-title-row">
        <div>
          <p className="eyebrow">{event.name}</p>
          <h1>Attendees</h1>
          <p className="subtitle">All attendees registered for this event.</p>
        </div>
        <div className="attendee-title-actions">
          <button
            className="secondary-button"
            type="button"
            ref={importButtonRef}
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
          >
            <Icon name="upload" size={16} />Import CSV
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv,text/plain"
            hidden
            aria-label="CSV file with attendees"
            onChange={chooseFile}
          />
          <button
            className="primary-button"
            type="button"
            ref={buttonRef}
            disabled={busy}
            onClick={() => {
              returnFocusRef.current = buttonRef.current
              setNotice('')
              setImportError('')
              setDeleteError('')
              setAdding(true)
            }}
          >
            <Icon name="plus" size={16} />New attendee
          </button>
        </div>
      </div>
      {importError && <div className="load-error action-error" role="alert">{importError}</div>}
      {importFile && <AttendeeImport
        eventCode={event.code}
        fileName={importFile.name}
        csv={importFile.csv}
        onCreated={(attendee) => setAttendees((current) => [...current, attendee])}
        onClose={closeForm}
      />}
      {(adding || editing) && <AttendeeForm
        key={editing?.code ?? 'new'}
        eventCode={event.code}
        attendee={editing}
        onClose={closeForm}
        onSaved={(attendee) => {
          setAttendees((current) => editing
            ? current.map((item) => item.code === attendee.code ? attendee : item)
            : [...current, attendee])
          setNotice(`${attendee.first_name} ${attendee.last_name} was ${editing ? 'updated' : 'added'}.`)
          closeForm()
        }}
      />}
      {notice && <p role="status" className="subtitle attendee-notice">{notice}</p>}
      {deleteError && <div className="load-error action-error" role="alert">Some attendees could not be deleted. {deleteError}</div>}
      {confirmDelete && <AttendeeDeleteConfirm
        eventCode={event.code}
        attendees={confirmDelete}
        onDeleted={finishDelete}
        onClose={closeForm}
      />}
      <section className="form-card" aria-labelledby="attendee-list-heading" aria-busy={loading}>
        <div className="section-heading">
          <div>
            <h2 id="attendee-list-heading" tabIndex={-1} ref={listHeadingRef}>Event attendees</h2>
            {!loading && !error && <p>
              {filtering && `${visibleAttendees.length} of `}
              {attendees.length} {attendees.length === 1 ? 'attendee' : 'attendees'}{filtering && ' shown'}
              {selectedAttendees.length > 0 && `, ${selectedAttendees.length} selected`}
            </p>}
          </div>
          {selectedAttendees.length > 0 && !loading && !error ? (
            <button
              className="danger-button"
              type="button"
              disabled={rowBusy}
              onClick={(clickEvent) => startDelete(selectedAttendees, clickEvent.currentTarget)}
            >
              <Icon name="trash" size={16} />Delete selected ({selectedAttendees.length})
            </button>
          ) : <Icon name="people" />}
        </div>
        {loading ? <p className="list-message" role="status">Loading attendees...</p> : error ? (
          <div className="load-error" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => {
              setError('')
              setLoading(true)
              setAttempt((value) => value + 1)
            }}>Try again</button>
          </div>
        ) : attendees.length === 0 ? (
          <p className="list-message">No attendees have been registered for this event yet.</p>
        ) : (<>
          <AttendeeSearch value={search} onChange={setSearch} controls="attendee-list" />
          {visibleAttendees.length === 0 ? (
            <p className="list-message" role="status">No attendees match “{search.trim()}”.</p>
          ) : (
          <div className="attendee-table-scroll attendee-list-scroll" ref={listScrollRef} tabIndex={0} aria-label="Attendee list, scrollable" id="attendee-list">
            <table className="attendee-table">
              <thead>
                <tr>
                  <td className="attendee-select-cell">
                    <input
                      ref={selectAllRef}
                      type="checkbox"
                      aria-label={filtering ? 'Select all shown attendees' : 'Select all attendees'}
                      checked={allSelected}
                      disabled={rowBusy}
                      onChange={() => setSelected((current) => {
                        const next = new Set(current)
                        for (const attendee of visibleAttendees) {
                          if (allSelected) next.delete(attendee.code)
                          else next.add(attendee.code)
                        }
                        return next
                      })}
                    />
                  </td>
                  <SortableHeadings sort={sort} onSort={(property) => setSort((current) => nextSort(current, property))} />
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleAttendees.map((attendee) => (
                  <tr key={attendee.code} className={selected.has(attendee.code) ? 'selected' : undefined}>
                    <td className="attendee-select-cell">
                      <input
                        type="checkbox"
                        aria-label={`Select ${fullName(attendee)}`}
                        checked={selected.has(attendee.code)}
                        disabled={rowBusy}
                        onChange={() => toggleSelected(attendee.code)}
                      />
                    </td>
                    <AttendeeCells attendee={attendee} />
                    <td>
                      <div className="attendee-row-actions">
                        <button
                          className="secondary-button"
                          type="button"
                          aria-label={`Edit ${fullName(attendee)}`}
                          disabled={rowBusy}
                          onClick={(clickEvent) => {
                            returnFocusRef.current = clickEvent.currentTarget
                            setNotice('')
                            setEditing(attendee)
                          }}
                        >
                          <Icon name="edit" size={16} />Edit
                        </button>
                        <button
                          className="danger-button attendee-delete-button"
                          type="button"
                          aria-label={`Delete ${fullName(attendee)}`}
                          title="Delete"
                          disabled={rowBusy}
                          onClick={(clickEvent) => startDelete([attendee], clickEvent.currentTarget)}
                        >
                          <Icon name="trash" size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
        </>)}
      </section>
    </>
  )
}
