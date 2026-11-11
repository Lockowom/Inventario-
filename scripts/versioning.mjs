import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

export const VERSION_PATTERN = /^\d+\.\d+\.\d{2}\.\d{2}$/

function versionFileFrom(args = process.argv.slice(2)) {
  const index = args.indexOf('--file')
  return path.resolve(process.cwd(), index >= 0 && args[index + 1] ? args[index + 1] : 'version.json')
}

export function validateVersionConfig(value) {
  if (!value || typeof value !== 'object') throw new Error('VERSION_CONFIG_INVALID')
  const { version, versionCode } = value
  if (typeof version !== 'string' || !VERSION_PATTERN.test(version)) throw new Error('VERSION_FORMAT_INVALID')
  if (!Number.isInteger(versionCode) || versionCode <= 0) throw new Error('VERSION_CODE_INVALID')
  return { version, versionCode }
}

export function readVersionConfig(file = path.resolve(process.cwd(), 'version.json')) {
  return validateVersionConfig(JSON.parse(fs.readFileSync(file, 'utf8')))
}

export function nextVersion(version) {
  if (!VERSION_PATTERN.test(version)) throw new Error('VERSION_FORMAT_INVALID')
  const values = version.split('.').map(Number)
  values[3] += 1
  if (values[3] > 99) { values[3] = 0; values[2] += 1 }
  if (values[2] > 99) { values[2] = 0; values[1] += 1 }
  return `${values[0]}.${values[1]}.${String(values[2]).padStart(2, '0')}.${String(values[3]).padStart(2, '0')}`
}

export function bumpVersionConfig(config) {
  const current = validateVersionConfig(config)
  return { version: nextVersion(current.version), versionCode: current.versionCode + 1 }
}

export function writeVersionConfig(file, config) {
  const valid = validateVersionConfig(config)
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(valid, null, 2)}\n`, { encoding: 'utf8', mode: 0o644 })
  fs.renameSync(temporary, file)
  return valid
}

function print(config) {
  console.log('INVEN3')
  console.log(`Version: ${config.version}`)
  console.log(`VersionCode: ${config.versionCode}`)
}

const [command = 'show'] = process.argv.slice(2)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = versionFileFrom()
  if (command === 'show') print(readVersionConfig(file))
  else if (command === 'validate') { print(readVersionConfig(file)); console.log('VERSION_CONFIG_VALID') }
  else if (command === 'bump') print(writeVersionConfig(file, bumpVersionConfig(readVersionConfig(file))))
  else throw new Error(`Unsupported version command: ${command}`)
}
