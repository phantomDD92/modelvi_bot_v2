# AI Branch Summary

This branch contains fixes for FANVUE, KNKY, and MALOUM bots.

## Branch Details

- Base branch: MODELVI-11
- Branch name: ai
- Total commits: 5

## Commits

### 1. Fix FANVUE createPost (e30f072)

**Problem**: Direct tRPC API POST to post.createPost endpoint no longer works.

**Solution**: Replaced with UI-based automation that:
- Navigates to fanvue.com homepage
- Finds and fills compose textarea
- Clicks "Add from vault" button
- Selects media from vault picker (by UUID matching)
- Confirms selection with "Add Media" button
- Clicks "Create post" button
- Captures the createPost API response

**Files changed**: src/browser/fanvue-browser.ts

### 2. Fix KNKY: Simplify refreshToken (3cc7039)

**Changes**:
- Changed refreshToken(this.settings) to refreshToken() (no parameter needed)
- Added doTest() method for testing session refresh logic
- Test method waits 5 minutes then tries to call getVaults with retry logic

**Files changed**: src/bot/knky-bot.ts

### 3. Fix base-browser: Firefox stability (79b8e2c)

**Changes**:
- Commented out StealthPlugin for KNKY (was causing issues)
- Changed waitForTimeout to use native Promise instead of page.waitForTimeout
- Improves reliability and prevents timeout-related crashes

**Files changed**: src/browser/base-browser.ts

### 4. Enable force flag (635d7dd)

Debug flag change to enable force mode for testing.

**Files changed**: src/bot.ts

### 5. Fix KNKY: OTP modal selector (233e711)

**Changes**:
- Changed selector from otpVerificationModal to drawerModal
- Added early return after successful home page load
- Fixes 2FA code input for updated KNKY UI

**Files changed**: src/browser/knky-browser.ts

## Testing Notes

### FANVUE
The UI-based createPost is more robust than direct API calls. It:
- Handles UI changes gracefully with multiple selector fallbacks
- Captures the actual API response for verification
- Falls back from schedulePost API to createPost UI when needed

### KNKY
- Session refresh now works without passing settings parameter
- OTP modal selector updated to match current KNKY UI
- StealthPlugin disabled to prevent Firefox crashes

### MALOUM
No changes in this branch. Current implementation already has Cloudflare handling.

## How to Merge

To merge into MODELVI-11:
```bash
git checkout MODELVI-11
git merge ai
```

To push ai branch to remote:
```bash
git push origin ai
```

## Code Structure Notes

David's codebase differs from our local version:
- Constructor pattern: `constructor(config, logger)` vs our `constructor(config, logger, api)`
- Authentication: Uses old `/bot/platform/:platform` API endpoint
- No ApiService imports in browser classes

These differences were preserved - only specific bug fixes were ported.
