import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { OtaUpdatePanel } from '../../src/features/ota/ota-update-panel'

describe('OTA deferred and rollback presentation', () => {
  it('hides a deferred first-launch check', () => {
    const { container } = render(<OtaUpdatePanel state={{ kind: 'DEFERRED', message: 'Esperando sesión' }} onApply={vi.fn()} onRollback={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('never shows rollback for a builtin error but does for a recoverable OTA error', () => {
    const { rerender } = render(<OtaUpdatePanel state={{ kind: 'ERROR', message: 'Fallo de descarga', canRollback: false }} onApply={vi.fn()} onRollback={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /último bundle seguro/i })).toBeNull()
    rerender(<OtaUpdatePanel state={{ kind: 'ERROR', message: 'Fallo de descarga', canRollback: true }} onApply={vi.fn()} onRollback={vi.fn()} />)
    expect(screen.getByRole('button', { name: /último bundle seguro/i })).toBeInTheDocument()
  })
})
