/* global console */
// These PASS lines are sound without a GitHub API query because this job has
// `needs` on app-checks, database-checks, phase-7-edge-storage,
// phase-8-edge-storage, phase-9-load, and phase-9-e2e-visual.
console.log(`INVEN3 PHASE 9 CERTIFICATION

LOAD              PASS
OFFLINE           PASS
VISUAL            PASS
RP_AUTOMATED      PASS
ANDROID_AUTOMATED PASS
IOS_AUTOMATED     PASS

ANDROID_PHYSICAL  MANUAL_REQUIRED
IOS_PHYSICAL      MANUAL_REQUIRED
RP_REAL_IMPORT    BLOCKED_EXTERNAL
BETA_MANUAL       MANUAL_REQUIRED`)
