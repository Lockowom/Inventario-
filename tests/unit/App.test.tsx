import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { App } from '../../src/app/App'

describe('pantalla técnica', () => {
  it('muestra el estado de infraestructura', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'INVEN3' })).toBeInTheDocument()
    expect(screen.getByText('NOT CONFIGURED')).toBeInTheDocument()
  })
})
