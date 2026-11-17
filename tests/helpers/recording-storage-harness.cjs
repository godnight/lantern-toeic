'use strict';
// Keep the old test entry name while reusing H4's authenticated recording fixture.
// It creates actual registered users/cookies before injecting recording-only D1
// or R2 faults. Session queries remain real and outside those fault hooks.
module.exports = require('./account-recording-storage-harness.cjs');
