import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSwipe } from '../../src/ui/gestures/use-gestures'
import { useKeyboardShortcuts } from '../../src/ui/shortcuts/use-keyboard-shortcuts'
import { ExperiencePanel } from '../../src/ui/preferences/experience-panel'
import { ExperienceProvider } from '../../src/ui/preferences/experience-preferences'
import { interactionSounds } from '../../src/ui/sound/interaction-sound-service'

afterEach(() => { window.localStorage.clear() })

describe('interaction system', () => {
  it('persists an operator preference without relying on a backend', () => {
    render(<ExperienceProvider><ExperiencePanel /></ExperienceProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'EXPERIENCIA' }))
    fireEvent.click(screen.getByLabelText('Activar sonidos'))
    expect(JSON.parse(window.localStorage.getItem('inven3.experience.v1') ?? '{}')).toMatchObject({ sounds: false })
  })

  it('detects a touch swipe locally', () => {
    const left = vi.fn()
    function Probe() { const swipe = useSwipe({ onSwipeLeft: left }); return <div data-testid="swipe" {...swipe} /> }
    render(<Probe />)
    const target = screen.getByTestId('swipe')
    fireEvent.pointerDown(target, { pointerType: 'touch', clientX: 100, clientY: 20 })
    fireEvent.pointerUp(target, { pointerType: 'touch', clientX: 10, clientY: 20 })
    expect(left).toHaveBeenCalledOnce()
  })

  it('does not run shortcuts while an operator is typing', () => {
    const refresh = vi.fn()
    function Probe() { useKeyboardShortcuts([{ key: 'r', handler: refresh }]); return <input aria-label="Buscar" /> }
    render(<Probe />)
    fireEvent.keyDown(window, { key: 'r' })
    fireEvent.keyDown(screen.getByLabelText('Buscar'), { key: 'r' })
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('keeps sound failures non-blocking before a browser grants audio access', () => {
    expect(() => { interactionSounds.playScanSuccess(); interactionSounds.playError() }).not.toThrow()
  })
})
