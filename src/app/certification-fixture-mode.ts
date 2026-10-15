/** Keeps certification-only UI unreachable from production bundles at runtime. */
export function isCertificationFixtureEnabled(environment: { dev: boolean; fixture: string | undefined }): boolean {
  return environment.dev && environment.fixture === '1'
}
