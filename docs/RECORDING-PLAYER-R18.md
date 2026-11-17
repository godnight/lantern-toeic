# CT r18 recording player candidate

Independent local branch: `fix/ct-recording-player-20261016`; baseline r17 commit `befbb6042ff65d14ed87e287fe89d6d2eddf74c1`. Planned freeze ID: `CT-20261016-r18`, version `0.3.5/20033`. The generated runtime manifest and build receipts are the authoritative identity.

This candidate repairs one confirmed URL lifecycle defect: a media error changed the history player's state object and caused its effect cleanup to revoke the same mounted Blob URL. The history owner now releases by URL replacement or unmount. Closing, changing owner/page/tab, or unmounting invalidates pending reads; a late read cannot reopen the dialog. The shared player does not create, revoke, transcode, or replace audio bytes.

Historical and current recording playback share loading, metadata, playing, paused, ended, and readable media error states. Finite zero duration is reported only after metadata is available. Unknown or infinite duration and a ten-second information timeout are not treated as proof of corrupt audio. The first media error is retained until an explicit retry. There is no automatic retry or repeated play loop. Current recording playback retains its existing manual start behavior.

History provides a download link to the exact same source URL, using the existing native recording filename/MIME allowlist. Native permission and download scope are unchanged. Bounded diagnostics expose numeric source aliases and media state only; they omit URLs, recording IDs, content, raw error messages, and stacks. Diagnostic events cannot control playback.

Development evidence at source completion: 841/841 CJS assertions passed, including URL ownership, stale callback isolation, navigation ABA, StrictMode, first-error preservation, and bounded diagnostic schema tests. Native schema logic was tested after TypeScript transformation; this does not replace ArkTS SDK compilation or ArkWeb device acceptance. Earlier fixture-only failures remain in the external evidence directory.

The historical recording `5309251d-d210-4e37-b42f-23da68c7e061` remains the native diagnosis target. The URL lifecycle defect does not by itself establish the cause of its first media error. Original bytes/container/codec and first native error must be assessed from actual evidence. New recording and bidirectional recording/playback mutual exclusion are not covered by these pure tests.

No database migration, cleanup, reconstruction, silent audio conversion, original replacement, downgrade, push, merge, deployment, upload, or release is part of this change. Frozen r17 and its independent QA FAIL remain intact. Web/SDK/native outcomes and final preserved-data checks are recorded separately in the candidate handoff; passing tests is not user approval or release authorization.
