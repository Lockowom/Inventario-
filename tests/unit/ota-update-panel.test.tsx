import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { OtaUpdatePanel } from '../../src/features/ota/ota-update-panel'

describe('OTA deferred and rollback presentation', () => {
  it('hides a deferred first-launch check', () => {
    const { container } = render(<OtaUpdatePanel state={{ kind: 'DEFERRED', message: 'Esperando sesión' }} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('keeps recovery automatic and never asks an operator to roll back', () => {
    const { rerender } = render(<OtaUpdatePanel state={{ kind: 'ERROR', message: 'Fallo de descarga', canRollback: false }} />)
    expect(screen.queryByRole('button')).toBeNull()
    rerender(<OtaUpdatePanel state={{ kind: 'ERROR', message: 'Fallo de descarga', canRollback: true }} />)
    expect(screen.getByText(/último bundle validado/i)).toBeInTheDocument()
  })
})
