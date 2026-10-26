# onsite-print-event

Standalone facilitator application for managing one event's attendees and
printing name tags. It uses React, Vite, and the same-origin `/api/v2/` REST API.
System-wide event, booking, and printer administration lives in the sibling
`onsite-print-admin` application at `/admin/`.

## Facilitator workspace

Open `/event/` (or `/event`, which redirects through nginx) to enter an event
code and view that event's dashboard. The page has its own framing and styles,
with a single sidebar and a full-width workspace. Before login, only
the event-code form is available. After a successful lookup, the sidebar shows
Event, Attendees, and Check-in, plus Log out. Event shows the event name, code,
dates, status, location, and its booked printers with their booking periods.
Attendees lists everyone registered for the current event, ordered by last name
and first name, with company, email, phone, address, postal code, city, and country.
The table scrolls horizontally on smaller screens.
Click any column heading to sort by that property; click again to reverse the
direction. Name sorts by last name, then first name, and is the default sort.
The active heading indicates the sort direction. Newly added or updated attendees follow
the selected sort.
The top "New attendee"
button opens a form; first and last name are required, with optional contact,
company, and address fields. Saving adds the attendee to the list. Loading and
save failures are shown explicitly, with retry support. Each row has an "Edit"
button that opens the same form prefilled with the attendee's details. "Save
changes" updates that row; "Cancel" discards unsaved edits. Failed saves keep
the draft open for correction or retry. If an attendee with the same first name,
last name, and email already exists, the form asks before adding a duplicate.
A search field above the list filters it as you type. Every word must be
found in some attendee field (name, company, email, phone, address, postal
code, city, or country), ignoring case and accents (so "kobenhavn" finds
"København"); spaces inside values are ignored, so "12345678" finds
"+45 12 34 56 78". Escape or "Clear" resets the search. The heading shows how
many attendees match, and the select-all checkbox only affects the shown
attendees. Selected attendees stay selected while hidden by a search, and the
delete confirmation lists all of them.

The list fills the remaining window height and scrolls vertically and
horizontally inside its frame, with the column headings kept visible. It
re-fits when the window is resized or content above it changes, and never
shrinks below 240px.

Each row starts with a checkbox, and the checkbox in the heading selects or
clears all attendees (it shows a mixed state when only some are selected).
While one or more attendees are selected, a "Delete selected" button appears in
the list heading. A trash button next to each row's "Edit" button deletes just
that attendee. Either way, a confirmation lists every attendee that will be
deleted before anything is removed. Attendees are deleted one by one; any that
fail stay in the list and selected, with the error shown.

The top "Import CSV" button opens a file dialog. The file (up to 5 MB, UTF-8 or
Windows-1252, comma-, semicolon-, or tab-separated, with quoted values) must
parse as CSV with the same number of columns in every row; otherwise an error
explains why. The import view shows a "Skip first row" checkbox above a
preview of the first five rows. It is checked when the first row looks like
column headings. Each preview column has a dropdown in its heading for choosing
the attendee property it imports, or "Do not import". Choosing a property
already used by another column swaps the two columns. English and Danish
headings such as "First name"/"Fornavn" are mapped automatically. First and last name
are required. Rows are created one by one with progress, and the import can be
stopped. Each duplicate prompt shows a table comparing every property of the
registered attendee with the row in the file, with differences highlighted. You
choose Create duplicate, Create all
duplicates, Skip, Skip all duplicates, or Stop import. The "all" choices are
not asked again during that import. A summary lists added, duplicate, skipped,
and failed rows. Rows missing a name are reported rather than sent.

Attendees uses the existing event-scoped `GET` and `POST`
`/api/v2/attendees/{event_code}` endpoints. Blank optional fields are sent as
`null`, matching the current API schema. Updates use
`PUT /api/v2/attendees/{event_code}/{attendee_code}`, and deletes use `DELETE`
on the same path; an attendee that is already gone counts as deleted. A duplicate create
returns 409 with detail code `attendee_exists`. Confirmed duplicates are
re-sent with `?allow_duplicate=true`.

Check-in first asks which of the event's printers this desk uses. Only
printers with a booking covering today can be chosen; the choice is remembered
per event in browser storage, and "Change printer" picks another. The attendee
list then appears with the same search, sortable columns, and scroll frame as
Attendees, but each row starts with a printer button instead of a checkbox.
Pressing it creates a name tag with
`POST /api/v2/nametags/{event_code}/{booking_code}` on today's booking, using
`layout_2` with the full name as line 1 and the company as line 3. A printed
row shows a check mark and can be printed again; failures are shown with the
API's reason.

Printers are loaded using the existing `/api/v2/bookings/` and
`/api/v2/printers/` collections, filtered to bookings belonging to the selected
event and grouped by printer. Unrelated printers are not displayed. Loading
failures show a retry option without hiding the event properties.

Codes are trimmed and converted to uppercase, then looked up directly with
`GET /api/v2/events/{event_code}`; no event list is downloaded. Missing events,
invalid codes, and connection failures show actionable errors. "Log out"
returns to code entry. Reloading requires entering the code again; codes are
not persisted in browser storage or URLs. Code entry is a lookup, not a new
authentication or authorization mechanism.

For standalone development, use <http://localhost:5173/event/>. The event
image serves only `/event/`, with its assets under `/event/assets/`. The gateway
forwards `/event/` to the independent `event` service in HTTP and HTTPS
deployments. `/admin/` is not served by this image.

The extraction preserves API payloads, CSV handling, and the
`onsite-print:checkin-printer:{event_code}` browser-storage key shared with the
scanner app. There are no imports, runtime assets, or build dependencies from
the admin repository. The initial base stylesheet is copied from the original
combined app to preserve appearance; it is now maintained locally.

## Start in the dev container

1. Install Docker and the **Dev Containers** extension
   (`ms-vscode-remote.remote-containers`) in VS Code.
2. Open this folder in VS Code and select **Dev Containers: Reopen in Container**
   from the Command Palette.
3. In the VS Code terminal inside the container, run:

   ```sh
   npm run dev
   ```

4. Open <http://localhost:5173/event/>. VS Code forwards the development port.

The container includes Node.js 24, npm, Git, and ESLint. Dependencies install
automatically when the container is created. The API proxy targets
`http://host.docker.internal:8000`; use relative `/api/v2/` URLs when adding
backend calls. The event dashboard reads `GET /api/v2/events/{event_code}`,
`GET /api/v2/bookings/`, and `GET /api/v2/printers/`.
If an endpoint fails, the page shows the API
error and a retry option.

The dev container mounts `~/.copilot/session-state` from the host. Create that
directory before reopening the container if needed. It can contain sensitive
conversation data, so use the container only with trusted code.

## Commands

```sh
npm run dev      # Start the development server
npm run lint     # Check JavaScript and React code
npm test         # Event, attendee, CSV, printing, and API tests
npm run build    # Create a production build in dist/
npm run preview  # Preview the production build
bash tests/docker-push-test.sh
```

## Run without a container

Install Node.js 24 (the version in `.nvmrc`), then run:

```sh
npm ci
npm run dev
```

The development API proxy defaults to `http://127.0.0.1:8000`, matching the
backend's direct development server. API documentation is available at
<http://127.0.0.1:8000/api/v2/docs>. Override `API_PROXY_TARGET` to use another
server, for example `http://localhost:8080` for the full-stack gateway.

When using the dev container, the backend must be reachable from the container
at `host.docker.internal:8000`; a backend listening only on the host's loopback
address will need a reachable bind address. Reopen the dev container after
changing its environment configuration.

## Container image

The production image serves the built app under `/event/`. To publish it, put
`IMAGE_TAG=0.0.1` (or the next release version) in `.env`, set `CR_PAT`
securely in the environment with GHCR `write:packages` permission, then run:

```sh
bash docker-push.sh
```

The script publishes `ghcr.io/groskopf/onsite-print-event:<IMAGE_TAG>` and
increments the patch version in `.env` only after a successful push. Do not
commit credentials or copy a populated `.env` from another project.
