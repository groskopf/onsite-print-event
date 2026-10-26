export function Icon({ name, size = 20 }) {
  const paths = {
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>,
    ticket: <><path d="M4 5h16v4a3 3 0 0 0 0 6v4H4v-4a3 3 0 0 0 0-6V5Z" /><path d="M13 8v2m0 4v2" /></>,
    people: <><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="10" cy="7" r="4" /><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    printer: <><path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><path d="M6 14h12v7H6z" /><path d="M18 12h.01" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    chevron: <path d="m9 18 6-6-6-6" />,
    chevronLeft: <path d="m15 18-6-6 6-6" />,
    edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></>,
    trash: <><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /></>,
    check: <path d="M20 6 9 17l-5-5" />,
    close: <path d="M18 6 6 18M6 6l12 12" />,
    plus: <path d="M12 5v14M5 12h14" />,
    upload: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m17 8-5-5-5 5M12 3v12" /></>,
  }

  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  )
}

export function Sidebar({ activeView, onNavigate, eventOpen, onLogout }) {
  const navigation = eventOpen ? [
    ['calendar', 'Event', 'event'],
    ['people', 'Attendees', 'attendees'],
    ['check', 'Check-in', 'checkin'],
  ] : []

  return (
    <aside className="sidebar" aria-label="Main navigation">
      <a className="brand" href="/event/" aria-label="Onsite Print home">
        <span className="brand-mark"><span /><span /><span /></span>
        <span className="brand-name">ONSITE<br />PRINT</span>
      </a>
      <nav className="primary-nav">
        {navigation.map(([icon, label, view]) => (
          <button
            className={`nav-item${view === activeView ? ' active' : ''}`}
            key={view}
            type="button"
            aria-current={view === activeView ? 'page' : undefined}
            onClick={() => onNavigate(view)}
            title={label}
          >
            <Icon name={icon} size={21} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-bottom">
        {eventOpen && (
          <button className="nav-item" type="button" onClick={onLogout}>
            <Icon name="chevronLeft" size={20} />
            <span>Log out</span>
          </button>
        )}
        <div className="profile-button">
          <span className="avatar">OP</span>
          <span className="profile-label">Event</span>
        </div>
      </div>
    </aside>
  )
}
