export type CertificationFixtureState = 'counting-normal' | 'counting-warning' | 'counting-critical' | 'counting-blocked' | 'cuts-ready' | 'rectification' | 'artifacts' | 'layout'

const fixtureStates: readonly CertificationFixtureState[] = ['counting-normal', 'counting-warning', 'counting-critical', 'counting-blocked', 'cuts-ready', 'rectification', 'artifacts', 'layout']

/** The selector is consumed only after App has admitted the DEV-only fixture. */
export function readCertificationFixtureState(search: string): CertificationFixtureState {
  const candidate = new URLSearchParams(search).get('fixture')
  return fixtureStates.includes(candidate as CertificationFixtureState) ? candidate as CertificationFixtureState : 'cuts-ready'
}
