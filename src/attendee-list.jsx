import { Icon } from './shell.jsx'
import { attendeeColumns } from './attendee-list-utils.js'
import { ATTENDEE_FIELDS } from './event-api.js'

export function AttendeeSearch({ value, onChange, controls }) {
  return (
    <div className="attendee-search-row">
      <label className="search-field attendee-search">
        <Icon name="search" size={18} />
        <input
          type="search"
          aria-label="Search attendees"
          aria-controls={controls}
          placeholder="Search name, company, email, phone, address..."
          value={value}
          onChange={(changeEvent) => onChange(changeEvent.target.value)}
          onKeyDown={(keyEvent) => {
            if (keyEvent.key === 'Escape' && value) {
              keyEvent.preventDefault()
              onChange('')
            }
          }}
        />
      </label>
      {value && (
        <button className="secondary-button" type="button" onClick={() => onChange('')}>
          <Icon name="close" size={16} />Clear
        </button>
      )}
    </div>
  )
}

export function SortableHeadings({ sort, onSort }) {
  return attendeeColumns.map(([key, label]) => (
    <th scope="col" key={key} aria-sort={sort.property === key ? sort.direction : undefined}>
      <button
        className="attendee-sort-button"
        type="button"
        onClick={() => onSort(key)}
        aria-label={`${label}: sort ${sort.property === key && sort.direction === 'ascending' ? 'descending' : 'ascending'}${key === 'last_name' ? ' by last name' : ''}`}
      >
        {label}
        <span aria-hidden="true" className={`attendee-sort-indicator${sort.property === key ? ` ${sort.direction}` : ''}`}>
          <Icon name="chevron" size={12} />
        </span>
      </button>
    </th>
  ))
}

export function AttendeeCells({ attendee }) {
  return <>
    <th scope="row">{attendee.first_name} {attendee.last_name}</th>
    {ATTENDEE_FIELDS.slice(2).map(([key]) => <td key={key}>{attendee[key] || '-'}</td>)}
  </>
}
