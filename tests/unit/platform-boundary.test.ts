import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(process.cwd(), 'src')
const platformRoot = join(root, 'platform')

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? sourceFiles(path) : /\.(ts|tsx)$/.test(entry.name) ? [path] : []
  })
}

describe('WIN-01 platform boundary', () => {
  it('keeps Capacitor, Capgo and Tauri imports inside platform adapters', () => {
    const directNativeImports = sourceFiles(root)
      .filter((path) => relative(platformRoot, path).startsWith('..'))
      .filter((path) => /from ['"]@(capacitor(?:-community)?|capgo|tauri-apps)\//.test(readFileSync(path, 'utf8')))
    expect(directNativeImports).toEqual([])
  })

  it('declares each platform seam required before Tauri is introduced', () => {
    const contracts = readFileSync(join(platformRoot, 'contracts.ts'), 'utf8')
    for (const name of ['StorageAdapter', 'ScannerAdapter', 'LifecycleAdapter', 'UpdateAdapter', 'PlatformCapabilities']) {
      expect(contracts).toContain(name)
    }
  })
})
