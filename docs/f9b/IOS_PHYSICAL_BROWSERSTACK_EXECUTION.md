# iOS Physical — BrowserStack App Live execution plan

## Purpose

Close `IOS_PHYSICAL` using a real iPhone in BrowserStack App Live. Simulator/WebKit results do not satisfy this gate.

## Required package

Run Codemagic workflow:

`INVEN3 iOS Real Device Package F9`

Expected artifact:

- `INVEN3-F9-unsigned-device.ipa`
- `INVEN3-F9-unsigned-device.sha256`

The IPA is built with the `iphoneos` SDK for real-device architecture and intentionally has code signing disabled. BrowserStack re-signs uploaded iOS apps for installation on its real-device cloud.

## Minimum physical matrix

Run at least:

1. iPhone 11 / iOS 15+ — compact/older baseline.
2. iPhone 15 Pro or iPhone 16 Pro / iOS 17–18 — standard Dynamic Island baseline.
3. iPhone Pro Max / current available iOS — large-screen baseline.

If trial time is limited, prioritize one standard iPhone first and expand only after the critical scenarios pass.

## Critical scenario — offline persistence

1. Launch app online.
2. Sign in with synthetic QA account only.
3. Select authorized QA inventory.
4. Confirm Health Check READY online.
5. Allow local master snapshot to be present.
6. Enable BrowserStack iOS Offline Mode.
7. Confirm Health Check resolves READY_OFFLINE.
8. Scan/enter QA SKU and save one synthetic count.
9. Confirm local status PENDING.
10. Close/reopen app.
11. Confirm the same pending count remains.
12. Restore connectivity.
13. Sync.
14. Confirm the same count becomes confirmed without duplicate creation.

PASS requires no loss and no duplicate technical record.

## Scanner scenario

Use BrowserStack Image Injection where available.

Validate:

- QR;
- Code128;
- GS1-128/EAN-128 if a sample is available;
- cancellation returns without autosave;
- scanner state returns to READY;
- scanned value reaches the expected INVEN3 field.

## Device Health

Record LIGHT and FULL where supported:

- APP_VERSION
- AUTH_USER
- INVENTORY_CONTEXT
- MASTER_SNAPSHOT
- LOCAL_DATABASE
- LOCAL_STORAGE
- BACKEND_CONNECTIVITY
- DEVICE_TIME
- CAMERA_AVAILABLE
- CAMERA_PERMISSION
- SCANNER_AVAILABLE

Warnings that are platform-provider limitations must be recorded explicitly; they are not silently converted to PASS.

## UI physical checks

Validate:

- safe area/top sensor area;
- Dynamic Island/notch;
- home indicator;
- keyboard opening/closing;
- portrait layout;
- touch targets;
- no horizontal overflow;
- scrolling through Health, Conteo, Supervisión and Cortes according to role.

## Evidence

Capture:

- BrowserStack session/device model and iOS version;
- screenshot of READY/READY_OFFLINE;
- screenshot of pending count while offline;
- screenshot of confirmed count after reconnect;
- scanner evidence;
- any BrowserStack session URL/ID available;
- IPA SHA-256.

Create the final execution JSON according to `docs/f9b/EVIDENCE_SCHEMA.md` and validate it with:

`node scripts/phase-9-manual-evidence-check.mjs <evidence.json>`

Only after physical execution may `IOS_PHYSICAL` move from `MANUAL_REQUIRED` to `PASS`.
