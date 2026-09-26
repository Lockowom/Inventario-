/* global console, process */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const allowedStatuses = new Set(['NOT_RUN', 'PASS', 'FAIL', 'BLOCKED'])
const physicalGates = new Set(['ANDROID_PHYSICAL', 'IOS_PHYSICAL'])
const requiredExecutionFields = ['execution_id', 'gate', 'status', 'candidate_sha', 'build_sha', 'app_version', 'started_at', 'finished_at', 'operator', 'environment', 'evidence_refs', 'defects', 'notes']
const requiredDefectFields = ['defect_id', 'gate', 'scenario', 'severity', 'description', 'expected', 'observed', 'evidence', 'build_sha', 'status', 'rerun']

function hasValue(value) {
  return typeof value === 'string' ? value.trim().length > 0 : value !== null && value !== undefined
}

function hasOpenBlockingDefect(defects) {
  return defects.some((defect) =>
    defect
    && ['BLOCKER', 'CRITICAL'].includes(String(defect.severity).toUpperCase())
    && String(defect.status).toUpperCase() === 'OPEN',
  )
}

export function validateManualEvidence(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return { complete: false, errors: ['INVALID_RECORD'] }

  const errors = []
  for (const field of requiredExecutionFields) {
    if (!hasValue(record[field])) errors.push(`MISSING_${field.toUpperCase()}`)
  }

  if (!allowedStatuses.has(record.status)) errors.push('INVALID_STATUS')
  if (!Array.isArray(record.evidence_refs)) errors.push('INVALID_EVIDENCE_REFS')
  if (!Array.isArray(record.defects)) errors.push('INVALID_DEFECTS')
  if (record.status === 'PASS' && (!Array.isArray(record.evidence_refs) || record.evidence_refs.length === 0)) errors.push('PASS_REQUIRES_EVIDENCE')

  if (physicalGates.has(record.gate)) {
    for (const field of ['device_category', 'device_model', 'os', 'os_version']) {
      if (!hasValue(record[field])) errors.push(`MISSING_${field.toUpperCase()}`)
    }
  }

  if (record.gate === 'RP_REAL_IMPORT') {
    for (const field of ['file_name', 'sha256', 'record_count', 'rp_environment', 'rows_accepted', 'rows_rejected']) {
      if (!hasValue(record[field])) errors.push(`MISSING_${field.toUpperCase()}`)
    }
  }

  if (record.gate === 'BETA_MANUAL') {
    for (const field of ['role', 'scenario', 'observer']) {
      if (!hasValue(record[field])) errors.push(`MISSING_${field.toUpperCase()}`)
    }
  }

  if (Array.isArray(record.defects)) {
    for (const defect of record.defects) {
      if (!defect || typeof defect !== 'object' || Array.isArray(defect)) {
        errors.push('INVALID_DEFECT')
        continue
      }
      for (const field of requiredDefectFields) {
        if (!hasValue(defect[field])) errors.push(`MISSING_DEFECT_${field.toUpperCase()}`)
      }
    }
    if (record.status === 'PASS' && hasOpenBlockingDefect(record.defects)) errors.push('PASS_HAS_OPEN_BLOCKING_DEFECT')
  }

  return { complete: errors.length === 0, errors }
}

async function main() {
  const file = process.argv[2]
  if (!file) {
    console.log('EVIDENCE_INCOMPLETE')
    return
  }

  try {
    const record = JSON.parse(await readFile(file, 'utf8'))
    console.log(validateManualEvidence(record).complete ? 'EVIDENCE_COMPLETE' : 'EVIDENCE_INCOMPLETE')
  } catch {
    console.log('EVIDENCE_INCOMPLETE')
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) void main()
