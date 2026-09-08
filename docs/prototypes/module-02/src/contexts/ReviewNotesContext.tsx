import { createContext, useContext, useState, type ReactNode } from 'react'

const STORAGE_KEY = 'metriccenter-review-notes-enabled'

interface ReviewNotesContextValue {
  enabled: boolean
  setEnabled: (value: boolean) => void
}

const ReviewNotesContext = createContext<ReviewNotesContextValue | null>(null)

export function ReviewNotesProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabledState] = useState(() => {
    try {
      return window.localStorage.getItem(STORAGE_KEY) === 'true'
    } catch {
      return false
    }
  })

  const setEnabled = (value: boolean) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(value))
    } catch {
      // ignore storage errors
    }
    setEnabledState(value)
  }

  return (
    <ReviewNotesContext.Provider value={{ enabled, setEnabled }}>
      {children}
    </ReviewNotesContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useReviewNotes() {
  const ctx = useContext(ReviewNotesContext)
  if (!ctx) {
    throw new Error('useReviewNotes must be used within ReviewNotesProvider')
  }
  return ctx
}