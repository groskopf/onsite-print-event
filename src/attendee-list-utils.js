import { useLayoutEffect } from 'react'
import { ATTENDEE_FIELDS } from './event-api.js'

const MIN_LIST_HEIGHT = 240

export const attendeeColumns = [['last_name', 'Name'], ...ATTENDEE_FIELDS.slice(2)]
export const fullName = (attendee) => `${attendee.first_name} ${attendee.last_name}`

// Fit the list to the window so it scrolls inside its frame instead of growing the page.
export function useFitToWindow(ref, active) {
  useLayoutEffect(() => {
    const list = ref.current
    if (!list) return undefined
    function fit() {
      const top = list.getBoundingClientRect().top + window.scrollY
      const below = document.documentElement.scrollHeight - (top + list.offsetHeight)
      const height = `${Math.max(MIN_LIST_HEIGHT, Math.floor(window.innerHeight - top - below))}px`
      if (list.style.maxHeight !== height) list.style.maxHeight = height
    }
    fit()
    // Content above the list (fonts, notices, forms) can change height without a re-render here.
    const observer = new ResizeObserver(fit)
    observer.observe(list.closest('main') ?? document.body)
    window.addEventListener('resize', fit)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', fit)
    }
  }, [ref, active])
}

export function nextSort(current, property) {
  return {
    property,
    direction: current.property === property && current.direction === 'ascending' ? 'descending' : 'ascending',
  }
}
