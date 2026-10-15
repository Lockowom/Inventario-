import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
vi.mock('../../src/services/supabase', () => ({
  isSupabaseConfigured: false,
  getSupabaseClient: () => null,
}))

import { App } from '../../src/app/App'

describe('pantalla técnica', () => {
  it('muestra el estado de infraestructura', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'INVEN3' })).toBeInTheDocument()
    expect(screen.getByText('NOT CONFIGURED')).toBeInTheDocument()
  })
})
