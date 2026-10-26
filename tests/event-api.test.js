import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ATTENDEE_FIELDS, AttendeeExistsError, EVENT_CODE_PATTERN, MAX_CSV_BYTES, assignCsvColumn, createAttendee, csvRowsToDrafts,
  decodeCsvBytes, deleteAttendee, filterAttendees, getEventPrinters, guessCsvMapping, loadAttendees, loadEvent, parseCsv, sortAttendees,
  updateAttendee, activeBooking, createNametag, localDate, nametagData,
} from '../src/event-api.js'

const code = 'ABCDEFGH234567AB'
const event = {
  code,
  name: 'Team event',
  start_date: '2026-10-24',
  end_date: '2026-10-25',
  street: null,
  zip: null,
  town: null,
  country: 'Denmark',
}

test('event codes follow the existing API format', () => {
  assert.ok(EVENT_CODE_PATTERN.test(code))
  for (const invalid of ['', 'abc', code.toLowerCase(), 'ABCDEFGH012389AB', `${code}A`]) {
    assert.equal(EVENT_CODE_PATTERN.test(invalid), false)
  }
})

test('event printers exclude unrelated bookings and group repeated printers', () => {
  const printers = [
    { code: 'B_2', label: '2', description: 'Second printer' },
    { code: 'A_1', label: '1', description: 'First printer' },
    { code: 'C_3', label: '3', description: 'Unrelated printer' },
  ]
  const booking = { event_code: code, start_date: '2026-10-24', end_date: '2026-10-25' }
  const bookings = [
    { ...booking, booking_code: 'one', printer_code: 'B_2' },
    { ...booking, booking_code: 'two', printer_code: 'A_1' },
    { ...booking, booking_code: 'three', printer_code: 'B_2' },
    { ...booking, booking_code: 'four', printer_code: 'C_3', event_code: 'OTHER' },
  ]
  const result = getEventPrinters(code, bookings, printers)
  assert.deepEqual(result.map((printer) => printer.code), ['A_1', 'B_2'])
  assert.deepEqual(result[1].bookings.map((item) => item.booking_code), ['one', 'three'])
  assert.deepEqual(getEventPrinters('EMPTY', bookings, printers), [])
  assert.equal('bookings' in printers[0], false)
})

test('missing booked printers and malformed booking dates show errors', () => {
  const booking = {
    event_code: code, printer_code: 'A_1', start_date: '2026-10-24', end_date: '2026-10-25',
  }
  assert.throws(() => getEventPrinters(code, [booking], []), /could not be found/)
  assert.throws(() => getEventPrinters(code, [{ ...booking, start_date: 'invalid' }],
    [{ code: 'A_1' }]), /invalid date/)
})

test('looks up only the requested event and forwards cancellation', async (context) => {
  const signal = new AbortController().signal
  const fetchMock = context.mock.method(globalThis, 'fetch', async () =>
    Response.json(event))
  assert.deepEqual(await loadEvent(code, signal), event)
  assert.equal(fetchMock.mock.callCount(), 1)
  assert.deepEqual(fetchMock.mock.calls[0].arguments, [
    `/api/v2/events/${code}`, { headers: { Accept: 'application/json' }, signal },
  ])
})

test('missing event has an actionable error', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => new Response('', { status: 404 }))
  await assert.rejects(loadEvent(code), /No event was found.*Check the code/)
})

test('server failures are not treated as valid events', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => new Response('', { status: 503 }))
  await assert.rejects(loadEvent(code), /Unable to open the event \(503\)/)
})

test('network and abort errors reach the caller', async (context) => {
  const failure = new TypeError('Failed to fetch')
  context.mock.method(globalThis, 'fetch', async () => { throw failure })
  await assert.rejects(loadEvent(code), failure)
  const abort = new DOMException('Aborted', 'AbortError')
  globalThis.fetch = async () => { throw abort }
  await assert.rejects(loadEvent(code), abort)
})

test('rejects malformed, mismatched, and invalid event details', async (context) => {
  for (const body of [
    null, [], {}, { ...event, code: 'BBBBBBBBBBBBBBBB' }, { ...event, name: '' },
    { ...event, start_date: 'not a date' }, { ...event, start_date: '2026-02-30' },
    { ...event, end_date: '2026-01-01' }, { ...event, town: {} },
  ]) {
    context.mock.method(globalThis, 'fetch', async () => Response.json(body))
    await assert.rejects(loadEvent(code), /unexpected response/)
    context.mock.restoreAll()
  }
})

const attendee = {
  code: 'ATTENDEE234567AB', event_code: code, first_name: 'Ada', last_name: 'Lovelace',
  company: null, email: null, phone: null, address: null, zip: null, city: null, country: null,
}

test('sorts every attendee column in both directions without mutating the list', () => {
  for (const [property] of ATTENDEE_FIELDS.slice(2)) {
    const rows = [
      { ...attendee, code: 'C', [property]: 'Value 10' },
      { ...attendee, code: 'B', [property]: 'value 2' },
      { ...attendee, code: 'A', [property]: null },
    ]
    assert.deepEqual(sortAttendees(rows, property).map((row) => row.code), ['A', 'B', 'C'])
    assert.deepEqual(sortAttendees(rows, property, 'descending').map((row) => row.code), ['C', 'B', 'A'])
    assert.deepEqual(rows.map((row) => row.code), ['C', 'B', 'A'])
    assert.deepEqual(sortAttendees([], property), [])
  }
})

test('name sorting uses surname then first name and breaks ties consistently', () => {
  const rows = [
    { ...attendee, code: 'D' },
    { ...attendee, code: 'C', last_name: 'Andersen', first_name: 'Zoe' },
    { ...attendee, code: 'B', last_name: 'Andersen', first_name: 'Anne' },
    { ...attendee, code: 'A', last_name: 'Andersen', first_name: 'Anne' },
  ]
  assert.deepEqual(sortAttendees(rows).map((row) => row.code), ['A', 'B', 'C', 'D'])
  assert.deepEqual(sortAttendees(rows, 'last_name', 'descending').map((row) => row.code), ['D', 'C', 'B', 'A'])
  assert.deepEqual(sortAttendees(rows, 'company').map((row) => row.code), ['A', 'B', 'C', 'D'])
})

test('loads only the current event attendees and sorts without mutating the response', async (context) => {
  const signal = new AbortController().signal
  const attendees = [
    attendee,
    { ...attendee, code: 'SECOND', first_name: 'Zoe', last_name: 'Andersen' },
    { ...attendee, code: 'THIRD', first_name: 'Anne', last_name: 'Andersen' },
  ]
  const fetchMock = context.mock.method(globalThis, 'fetch', async () => Response.json(attendees))
  assert.deepEqual((await loadAttendees(code, signal)).map((item) => item.code),
    ['THIRD', 'SECOND', attendee.code])
  assert.deepEqual(fetchMock.mock.calls[0].arguments, [
    `/api/v2/attendees/${code}`, { headers: { Accept: 'application/json' }, signal },
  ])
  assert.equal(attendees[0], attendee)
  globalThis.fetch = async () => Response.json([])
  assert.deepEqual(await loadAttendees(code), [])
})

test('rejects invalid attendee collections and attendees from another event', async (context) => {
  for (const body of [
    {}, null, [null], [{ ...attendee, event_code: 'OTHER' }],
    [{ ...attendee, first_name: ' ' }], [{ ...attendee, last_name: null }],
    [{ ...attendee, code: '' }], [{ ...attendee, email: {} }],
  ]) {
    context.mock.method(globalThis, 'fetch', async () => Response.json(body))
    await assert.rejects(loadAttendees(code), /unexpected response/)
    context.mock.restoreAll()
  }
})

test('creates attendees with trimmed names and nullable optional fields', async (context) => {
  const draft = Object.fromEntries(ATTENDEE_FIELDS.map(([key]) => [key, '  ']))
  Object.assign(draft, { first_name: ' Ada ', last_name: ' Lovelace ', city: ' London ' })
  const signal = new AbortController().signal
  const fetchMock = context.mock.method(globalThis, 'fetch', async () => Response.json(attendee, { status: 201 }))
  assert.deepEqual(await createAttendee(code, draft, signal), attendee)
  const [url, options] = fetchMock.mock.calls[0].arguments
  assert.equal(url, `/api/v2/attendees/${code}`)
  assert.equal(options.method, 'POST')
  assert.equal(options.signal, signal)
  assert.equal(options.headers['Content-Type'], 'application/json')
  assert.deepEqual(JSON.parse(options.body), {
    first_name: 'Ada', last_name: 'Lovelace', company: null, email: null, phone: null,
    address: null, zip: null, city: 'London', country: null,
  })
  await assert.rejects(createAttendee(code, { ...draft, first_name: ' ' }), /required/)
  assert.equal(fetchMock.mock.callCount(), 1)
})

test('attendee API errors preserve server details and cancellation', async (context) => {
  context.mock.method(globalThis, 'fetch', async () =>
    Response.json({ detail: 'Event not found' }, { status: 404 }))
  await assert.rejects(loadAttendees(code), /Unable to load attendees \(404\): Event not found/)
  globalThis.fetch = async () => Response.json({
    detail: [{ msg: 'First name is required' }],
  }, { status: 422 })
  const draft = Object.fromEntries(ATTENDEE_FIELDS.map(([key]) => [key, 'value']))
  await assert.rejects(createAttendee(code, draft), /Unable to create attendee \(422\): First name is required/)
  globalThis.fetch = async () => Response.json({ ...attendee, event_code: 'OTHER' })
  await assert.rejects(createAttendee(code, draft), /unexpected response/)
  const abort = new DOMException('Aborted', 'AbortError')
  globalThis.fetch = async () => { throw abort }
  await assert.rejects(loadAttendees(code), abort)
  await assert.rejects(createAttendee(code, draft), abort)
})

test('updates only the requested attendee with all editable fields', async (context) => {
  const draft = Object.fromEntries(ATTENDEE_FIELDS.map(([key]) => [key, attendee[key] ?? '']))
  Object.assign(draft, { first_name: ' Augusta ', email: ' ', city: ' London ' })
  const updated = { ...attendee, first_name: 'Augusta', city: 'London' }
  const signal = new AbortController().signal
  const fetchMock = context.mock.method(globalThis, 'fetch', async () => Response.json(updated))
  assert.deepEqual(await updateAttendee(code, attendee.code, draft, signal), updated)
  const [url, options] = fetchMock.mock.calls[0].arguments
  assert.equal(url, `/api/v2/attendees/${code}/${attendee.code}`)
  assert.equal(options.method, 'PUT')
  assert.equal(options.signal, signal)
  assert.equal(options.headers['Content-Type'], 'application/json')
  assert.deepEqual(JSON.parse(options.body), {
    first_name: 'Augusta', last_name: 'Lovelace', company: null, email: null, phone: null,
    address: null, zip: null, city: 'London', country: null,
  })
  await assert.rejects(updateAttendee(code, attendee.code, { ...draft, last_name: ' ' }), /required/)
  assert.equal(fetchMock.mock.callCount(), 1)
})

test('updates reject failed, mismatched and aborted responses', async (context) => {
  const draft = Object.fromEntries(ATTENDEE_FIELDS.map(([key]) => [key, attendee[key] ?? '']))
  context.mock.method(globalThis, 'fetch', async () =>
    Response.json({ detail: 'Attendee not found' }, { status: 404 }))
  await assert.rejects(updateAttendee(code, attendee.code, draft), /Unable to update attendee \(404\): Attendee not found/)
  for (const body of [null, { ...attendee, code: 'OTHER' }, { ...attendee, event_code: 'OTHER' }]) {
    globalThis.fetch = async () => Response.json(body)
    await assert.rejects(updateAttendee(code, attendee.code, draft), /unexpected response/)
  }
  const abort = new DOMException('Aborted', 'AbortError')
  globalThis.fetch = async () => { throw abort }
  await assert.rejects(updateAttendee(code, attendee.code, draft), abort)
})

test('duplicate attendees raise a recognizable error and can be allowed explicitly', async (context) => {
  const draft = Object.fromEntries(ATTENDEE_FIELDS.map(([key]) => [key, attendee[key] ?? '']))
  const fetchMock = context.mock.method(globalThis, 'fetch', async () => Response.json({
    detail: { code: 'attendee_exists', message: 'exists', attendee },
  }, { status: 409 }))
  await assert.rejects(createAttendee(code, draft), (error) =>
    error instanceof AttendeeExistsError && error.existing.code === attendee.code)
  assert.equal(fetchMock.mock.calls[0].arguments[0], `/api/v2/attendees/${code}`)
  fetchMock.mock.mockImplementation(async () => Response.json(attendee, { status: 201 }))
  assert.deepEqual(await createAttendee(code, draft, undefined, { allowDuplicate: true }), attendee)
  assert.equal(fetchMock.mock.calls[1].arguments[0], `/api/v2/attendees/${code}?allow_duplicate=true`)
  fetchMock.mock.mockImplementation(async () =>
    Response.json({ detail: { code: 'other', message: 'Conflict detail' } }, { status: 409 }))
  await assert.rejects(createAttendee(code, draft), (error) =>
    !(error instanceof AttendeeExistsError) && /\(409\): Conflict detail/.test(error.message))
})

test('deletes one attendee and treats an already deleted attendee as done', async (context) => {
  const signal = new AbortController().signal
  const fetchMock = context.mock.method(globalThis, 'fetch', async () => Response.json(attendee))
  assert.equal(await deleteAttendee(code, attendee.code, signal), undefined)
  const [url, options] = fetchMock.mock.calls[0].arguments
  assert.equal(url, `/api/v2/attendees/${code}/${attendee.code}`)
  assert.equal(options.method, 'DELETE')
  assert.equal(options.signal, signal)
  fetchMock.mock.mockImplementation(async () => Response.json({ detail: 'Attendee not found' }, { status: 404 }))
  await deleteAttendee(code, attendee.code)
  fetchMock.mock.mockImplementation(async () => Response.json({ detail: 'Event not found' }, { status: 404 }))
  await assert.rejects(deleteAttendee(code, attendee.code), /Unable to delete attendee \(404\): Event not found/)
  fetchMock.mock.mockImplementation(async () => Response.json({ detail: 'Boom' }, { status: 500 }))
  await assert.rejects(deleteAttendee(code, attendee.code), /Unable to delete attendee \(500\): Boom/)
})

test('searches every attendee field with all words, ignoring case and accents', () => {
  const list = [
    { ...attendee, code: 'a', first_name: 'Søren', last_name: 'Kierkegaard', company: 'Filosofi', city: 'København K',
      phone: '+45 12 34 56 78', email: 'soren@example.dk', zip: '1450', country: 'Danmark', address: 'Nytorv 2' },
    { ...attendee, code: 'b', first_name: 'Ada', last_name: 'Lovelace', company: 'Analytical Engines', city: 'London',
      phone: null, email: null, zip: 'SW1Y 4JH', country: 'United Kingdom', address: null },
  ]
  const codes = (query) => filterAttendees(list, query).map((item) => item.code)
  assert.equal(filterAttendees(list, '  '), list)
  assert.deepEqual(codes('kierke'), ['a'])
  assert.deepEqual(codes('SOREN kobenhavn'), ['a'])
  assert.deepEqual(codes('ada london'), ['b'])
  assert.deepEqual(codes('ada københavn'), [])
  assert.deepEqual(codes('engines'), ['b'])
  assert.deepEqual(codes('example.dk'), ['a'])
  assert.deepEqual(codes('12345678'), ['a'])
  assert.deepEqual(codes('sw1y4jh'), ['b'])
  assert.deepEqual(codes('1450'), ['a'])
  assert.deepEqual(codes('kingdom'), ['b'])
  assert.deepEqual(codes('null'), [])
  assert.deepEqual(codes('a'), ['a', 'b'])
})

test('parses quoted CSV with BOM, CRLF, semicolons, and blank lines', () => {
  const text = '\uFEFFFornavn;Efternavn;Note\r\n"Søren";"Kierke;gaard";"Line\nbreak ""quoted"""\r\n\r\n  ;  ;  \nAda;Lovelace;\n'
  assert.deepEqual(parseCsv(text), {
    delimiter: ';',
    columns: 3,
    rows: [['Fornavn', 'Efternavn', 'Note'], ['Søren', 'Kierke;gaard', 'Line\nbreak "quoted"'], ['Ada', 'Lovelace', '']],
  })
  assert.equal(parseCsv('a,b\n1,2').delimiter, ',')
  assert.equal(parseCsv('a\tb\n1\t2').delimiter, '\t')
  assert.deepEqual(parseCsv('"a" ,b').rows, [['a', 'b']])
  assert.deepEqual(parseCsv('single').rows, [['single']])
})

test('rejects files that are not valid CSV', () => {
  assert.throws(() => parseCsv(' \n \r\n'), /empty/)
  assert.throws(() => parseCsv('a,"b\n1,2'), /unterminated/)
  assert.throws(() => parseCsv('a,"b"c'), /after a closing quote/)
  assert.throws(() => parseCsv('a,b\n1,2,3'), /Row 2 has 3 columns, but row 1 has 2/)
  assert.throws(() => decodeCsvBytes(new Uint8Array([97, 0, 98]).buffer), /not a CSV text file/)
  assert.throws(() => decodeCsvBytes(new ArrayBuffer(MAX_CSV_BYTES + 1)), /larger than 5 MB/)
  assert.equal(decodeCsvBytes(new TextEncoder().encode('Ærø').buffer), 'Ærø')
  assert.equal(decodeCsvBytes(new Uint8Array([0xC6, 0x72, 0xF8]).buffer), 'Ærø')
})

test('guesses column mapping from English and Danish headings', () => {
  assert.deepEqual(guessCsvMapping(['E-mail', 'First name', 'Efternavn', 'Firma', 'Tlf.', 'Post nr', 'By', 'Notes']), {
    first_name: 1, last_name: 2, company: 3, email: 0, phone: 4, address: null, zip: 5, city: 6, country: null,
  })
  assert.ok(Object.values(guessCsvMapping(['Ada', 'Lovelace'])).every((column) => column === null))
})

test('converts mapped CSV rows to drafts with file row numbers and missing names', () => {
  const rows = [['first', 'last', 'mail'], [' Ada ', 'Lovelace', ' ada@example.com '], ['', 'Hopper', ''], ['Alan']]
  const mapping = { ...guessCsvMapping([]), first_name: 0, last_name: 1, email: 2 }
  const items = csvRowsToDrafts(rows, mapping, true)
  assert.deepEqual(items.map(({ row, error }) => [row, error]), [[2, ''], [3, 'Missing first name.'], [4, 'Missing last name.']])
  assert.deepEqual(items[0].draft, {
    first_name: 'Ada', last_name: 'Lovelace', company: '', email: 'ada@example.com', phone: '',
    address: '', zip: '', city: '', country: '',
  })
  assert.equal(csvRowsToDrafts(rows, mapping, false)[0].row, 1)
  assert.equal(csvRowsToDrafts(rows, mapping, false).length, 4)
})

test('assigning a property to a column swaps it with the column that had it', () => {
  const mapping = { ...guessCsvMapping([]), first_name: 0, last_name: 1, email: 2 }
  assert.deepEqual(assignCsvColumn(mapping, 0, 'last_name'), { ...mapping, first_name: 1, last_name: 0 })
  assert.deepEqual(assignCsvColumn(mapping, 3, 'email'), { ...mapping, email: 3 })
  assert.deepEqual(assignCsvColumn(mapping, 2, 'city'), { ...mapping, email: null, city: 2 })
  assert.deepEqual(assignCsvColumn(mapping, 3, 'city'), { ...mapping, city: 3 })
  assert.deepEqual(assignCsvColumn(mapping, 1, null), { ...mapping, last_name: null })
  assert.equal(assignCsvColumn(mapping, 0, 'first_name'), mapping)
  assert.deepEqual(assignCsvColumn({ ...mapping, email: null }, 2, 'first_name'), { ...mapping, email: null, first_name: 2 })
})

test('finds the booking that covers today', () => {
  const printer = { bookings: [
    { booking_code: 'A', start_date: '2026-10-20', end_date: '2026-10-21' },
    { booking_code: 'B', start_date: '2026-10-24', end_date: '2026-10-25' },
  ] }
  assert.equal(activeBooking(printer, '2026-10-25').booking_code, 'B')
  assert.equal(activeBooking(printer, '2026-10-22'), null)
  assert.equal(activeBooking(null, '2026-10-25'), null)
  assert.equal(localDate(new Date(2026, 0, 5)), '2026-01-05')
})

test('creates a name tag with the name and company', async () => {
  const attendee = { first_name: 'Ada', last_name: 'Lovelace', company: ' Analytical Engines ' }
  assert.deepEqual(nametagData({ ...attendee, company: null }), {
    layout: 'layout_2', line_1: 'Ada Lovelace', line_3: null,
  })
  const originalFetch = globalThis.fetch
  try {
    let request
    globalThis.fetch = async (url, options) => {
      request = { url, options }
      return new Response(JSON.stringify({ filename: 'tag.pdf' }), { status: 201 })
    }
    assert.deepEqual(await createNametag(code, 'BOOKINGCODE23456', attendee), { filename: 'tag.pdf' })
    assert.equal(request.url, `/api/v2/nametags/${code}/BOOKINGCODE23456`)
    assert.equal(request.options.method, 'POST')
    assert.deepEqual(JSON.parse(request.options.body), {
      layout: 'layout_2', line_1: 'Ada Lovelace', line_3: 'Analytical Engines',
    })
    globalThis.fetch = async () => new Response(JSON.stringify({ detail: 'Booking not valid today' }), { status: 400 })
    await assert.rejects(createNametag(code, 'BOOKINGCODE23456', attendee),
      /Unable to print the name tag \(400\): Booking not valid today/)
  } finally {
    globalThis.fetch = originalFetch
  }
})
