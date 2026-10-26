export const EVENT_CODE_PATTERN = /^[A-Z2-7]{16}$/

export const ATTENDEE_FIELDS = [
  ['first_name', 'First name', 'text', true],
  ['last_name', 'Last name', 'text', true],
  ['company', 'Company', 'text'],
  ['email', 'Email', 'email'],
  ['phone', 'Phone', 'tel'],
  ['address', 'Address', 'text'],
  ['zip', 'Postal code', 'text'],
  ['city', 'City', 'text'],
  ['country', 'Country', 'text'],
]

function validateAttendee(attendee, eventCode) {
  if (!attendee || typeof attendee.code !== 'string' || !attendee.code ||
      attendee.event_code !== eventCode ||
      !ATTENDEE_FIELDS.every(([key, , , required]) => required
        ? typeof attendee[key] === 'string' && attendee[key].trim()
        : attendee[key] == null || typeof attendee[key] === 'string')) {
    throw new Error('The attendees API returned an unexpected response. Please try again.')
  }
  return attendee
}

export function sortAttendees(attendees, property = 'last_name', direction = 'ascending') {
  const byName = (left, right) =>
    left.last_name.localeCompare(right.last_name) ||
    left.first_name.localeCompare(right.first_name) || left.code.localeCompare(right.code)
  return [...attendees].sort((left, right) => {
    const comparison = property === 'last_name' ? byName(left, right)
      : (left[property] ?? '').localeCompare(right[property] ?? '', undefined, {
        sensitivity: 'base', numeric: true,
      }) || byName(left, right)
    return direction === 'descending' ? -comparison : comparison
  })
}

const searchText = (value) => String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '')
  .toLocaleLowerCase().replace(/ø/g, 'o').replace(/æ/g, 'ae')

// Every word must be found in some attendee field, ignoring case and accents.
export function filterAttendees(attendees, query) {
  const terms = searchText(query).split(/\s+/).filter(Boolean)
  if (!terms.length) return attendees
  return attendees.filter((attendee) => {
    const values = ATTENDEE_FIELDS.map(([key]) => searchText(attendee[key])).filter(Boolean)
    const haystack = [...values, ...values.map((value) => value.replace(/\s+/g, ''))].join('\n')
    return terms.every((term) => haystack.includes(term))
  })
}

export class AttendeeExistsError extends Error {
  constructor(existing) {
    super('An attendee with the same name and email already exists.')
    this.name = 'AttendeeExistsError'
    this.existing = existing
  }
}

async function attendeeRequest(eventCode, options, attendeeCode, query = '') {
  const path = `/api/v2/attendees/${encodeURIComponent(eventCode)}${attendeeCode ? `/${encodeURIComponent(attendeeCode)}` : ''}${query}`
  const response = await fetch(path, options)
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    if (response.status === 409 && body?.detail?.code === 'attendee_exists') {
      throw new AttendeeExistsError(body.detail.attendee ?? null)
    }
    const detail = typeof body?.detail === 'string' ? body.detail
      : Array.isArray(body?.detail) ? body.detail.map((item) => item.msg).filter(Boolean).join('; ')
        : typeof body?.detail?.message === 'string' ? body.detail.message : response.statusText
    const action = options.method === 'PUT' ? 'update attendee'
      : options.method === 'POST' ? 'create attendee'
        : options.method === 'DELETE' ? 'delete attendee' : 'load attendees'
    const error = new Error(`Unable to ${action} (${response.status})${detail ? `: ${detail}` : ''}`)
    error.status = response.status
    throw error
  }
  return response.json()
}

export async function loadAttendees(eventCode, signal) {
  const attendees = await attendeeRequest(eventCode, {
    headers: { Accept: 'application/json' }, signal,
  })
  if (!Array.isArray(attendees)) {
    throw new Error('The attendees API returned an unexpected response. Please try again.')
  }
  return sortAttendees(attendees.map((attendee) => validateAttendee(attendee, eventCode)))
}

async function saveAttendee(eventCode, draft, signal, attendeeCode, allowDuplicate = false) {
  const body = Object.fromEntries(ATTENDEE_FIELDS.map(([key, , , required]) => {
    const value = (draft[key] ?? '').trim()
    if (required && !value) throw new Error('First name and last name are required.')
    return [key, value || null]
  }))
  const attendee = await attendeeRequest(eventCode, {
    method: attendeeCode ? 'PUT' : 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  }, attendeeCode, allowDuplicate ? '?allow_duplicate=true' : '')
  validateAttendee(attendee, eventCode)
  if (attendeeCode && attendee.code !== attendeeCode) {
    throw new Error('The attendees API returned an unexpected response. Please try again.')
  }
  return attendee
}

export function createAttendee(eventCode, draft, signal, { allowDuplicate = false } = {}) {
  return saveAttendee(eventCode, draft, signal, undefined, allowDuplicate)
}

export function updateAttendee(eventCode, attendeeCode, draft, signal) {
  return saveAttendee(eventCode, draft, signal, attendeeCode)
}

export async function deleteAttendee(eventCode, attendeeCode, signal) {
  try {
    await attendeeRequest(eventCode, { method: 'DELETE', headers: { Accept: 'application/json' }, signal }, attendeeCode)
  } catch (cause) {
    // An attendee that is already gone needs no further action.
    if (cause.status !== 404 || !/Attendee not found/.test(cause.message)) throw cause
  }
}

export const MAX_CSV_BYTES = 5 * 1024 * 1024
const CSV_DELIMITERS = [',', ';', '\t']

export function decodeCsvBytes(buffer) {
  if (buffer.byteLength > MAX_CSV_BYTES) throw new Error('The file is larger than 5 MB.')
  const bytes = new Uint8Array(buffer)
  if (bytes.includes(0)) throw new Error('The file is not a CSV text file.')
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    // Spreadsheet programs often export CSV in Windows-1252 rather than UTF-8.
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

function detectDelimiter(text) {
  const counts = new Map(CSV_DELIMITERS.map((delimiter) => [delimiter, 0]))
  let quoted = false
  for (const character of text) {
    if (character === '"') quoted = !quoted
    else if (!quoted && (character === '\n' || character === '\r')) break
    else if (!quoted && counts.has(character)) counts.set(character, counts.get(character) + 1)
  }
  return [...counts].reduce((best, entry) => entry[1] > best[1] ? entry : best)[0]
}

export function parseCsv(input) {
  const text = input.replace(/^\uFEFF/, '')
  if (!text.trim()) throw new Error('The file is empty.')
  const delimiter = detectDelimiter(text)
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  let afterQuote = false
  const endRow = () => {
    row.push(field)
    if (row.some((value) => value.trim())) rows.push(row)
    row = []
    field = ''
    afterQuote = false
  }
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (character === '"') {
        quoted = false
        afterQuote = true
      } else {
        field += character
      }
    } else if (character === delimiter) {
      row.push(field)
      field = ''
      afterQuote = false
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index += 1
      endRow()
    } else if (afterQuote && character.trim()) {
      throw new Error(`Row ${rows.length + 1} has text after a closing quote.`)
    } else if (afterQuote) {
      continue
    } else if (character === '"' && !field) {
      quoted = true
    } else {
      field += character
    }
  }
  if (quoted) throw new Error(`Row ${rows.length + 1} has an unterminated quoted value.`)
  endRow()
  const columns = rows[0].length
  const ragged = rows.findIndex((values) => values.length !== columns)
  if (ragged >= 0) {
    throw new Error(`Row ${ragged + 1} has ${rows[ragged].length} columns, but row 1 has ${columns}.`)
  }
  return { delimiter, columns, rows }
}

const CSV_HEADER_ALIASES = {
  first_name: ['firstname', 'first', 'givenname', 'fornavn'],
  last_name: ['lastname', 'last', 'surname', 'familyname', 'efternavn'],
  company: ['company', 'organization', 'organisation', 'firma', 'virksomhed'],
  email: ['email', 'emailaddress', 'mail'],
  phone: ['phone', 'telephone', 'mobile', 'phonenumber', 'telefon', 'tlf', 'mobil'],
  address: ['address', 'street', 'streetaddress', 'adresse', 'vej'],
  zip: ['zip', 'zipcode', 'postalcode', 'postcode', 'postnr', 'postnummer'],
  city: ['city', 'town', 'by'],
  country: ['country', 'land'],
}

export function guessCsvMapping(header) {
  const normalized = header.map((value) => value.toLowerCase().replace(/[^a-z0-9æøå]/g, ''))
  const used = new Set()
  return Object.fromEntries(ATTENDEE_FIELDS.map(([key]) => {
    const index = normalized.findIndex((value, column) =>
      !used.has(column) && [key.replace('_', ''), ...CSV_HEADER_ALIASES[key]].includes(value))
    if (index < 0) return [key, null]
    used.add(index)
    return [key, index]
  }))
}

export function assignCsvColumn(mapping, column, property) {
  const current = Object.keys(mapping).find((key) => mapping[key] === column) ?? null
  if (current === property) return mapping
  const next = { ...mapping }
  if (current) next[current] = property ? mapping[property] ?? null : null
  if (property) next[property] = column
  return next
}

export function csvRowsToDrafts(rows, mapping, skipFirstRow) {
  return rows.slice(skipFirstRow ? 1 : 0).map((values, index) => {
    const draft = Object.fromEntries(ATTENDEE_FIELDS.map(([key]) =>
      [key, mapping[key] == null ? '' : (values[mapping[key]] ?? '').trim()]))
    const missing = ATTENDEE_FIELDS.filter(([key, , , required]) => required && !draft[key])
    return {
      row: index + (skipFirstRow ? 2 : 1),
      draft,
      error: missing.length ? `Missing ${missing.map(([, label]) => label.toLowerCase()).join(' and ')}.` : '',
    }
  })
}

export function getEventPrinters(eventCode, bookings, printers) {
  const eventBookings = bookings.filter((booking) => booking.event_code === eventCode)
  const byCode = new Map(printers.map((printer) => [printer.code, printer]))
  const result = new Map()
  for (const booking of eventBookings) {
    const printer = byCode.get(booking.printer_code)
    if (!printer) throw new Error(`Printer ${booking.printer_code} could not be found.`)
    if (!isDate(booking.start_date) || !isDate(booking.end_date)) {
      throw new Error('The bookings API returned an invalid date.')
    }
    if (!result.has(printer.code)) result.set(printer.code, { ...printer, bookings: [] })
    result.get(printer.code).bookings.push(booking)
  }
  return [...result.values()].sort((left, right) => left.code.localeCompare(right.code))
}

export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

// Name tags can only be created on a booking that covers today.
export function activeBooking(printer, today = localDate()) {
  return printer?.bookings.find((booking) => booking.start_date <= today && today <= booking.end_date) ?? null
}

export const NAMETAG_LAYOUT = 'layout_2'

// Legacy layouts print line 1 as the name and line 3 as the company.
export function nametagData(attendee) {
  return {
    layout: NAMETAG_LAYOUT,
    line_1: `${attendee.first_name} ${attendee.last_name}`.trim(),
    line_3: attendee.company?.trim() || null,
  }
}

export async function createNametag(eventCode, bookingCode, attendee, signal) {
  const response = await fetch(
    `/api/v2/nametags/${encodeURIComponent(eventCode)}/${encodeURIComponent(bookingCode)}`,
    {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(nametagData(attendee)),
      signal,
    },
  )
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const detail = typeof body?.detail === 'string' ? body.detail
      : Array.isArray(body?.detail) ? body.detail.map((item) => item.msg).filter(Boolean).join('; ')
        : response.statusText
    throw new Error(`Unable to print the name tag (${response.status})${detail ? `: ${detail}` : ''}`)
  }
  if (typeof body?.filename !== 'string' || !body.filename) {
    throw new Error('The name tag API returned an unexpected response. Please try again.')
  }
  return body
}

function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export async function loadEvent(code, signal) {
  const response = await fetch(`/api/v2/events/${encodeURIComponent(code)}`, {
    headers: { Accept: 'application/json' },
    signal,
  })
  if (response.status === 404) {
    throw new Error('No event was found with this code. Check the code and try again.')
  }
  if (!response.ok) {
    throw new Error(`Unable to open the event (${response.status}). Please try again.`)
  }
  const event = await response.json()
  if (event?.code !== code || typeof event.name !== 'string' || !event.name.trim() ||
      ![event.start_date, event.end_date].every(isDate) || event.end_date < event.start_date ||
      !['street', 'zip', 'town', 'country'].every((key) =>
        event[key] == null || typeof event[key] === 'string')) {
    throw new Error('The event API returned an unexpected response. Please try again.')
  }
  return event
}
