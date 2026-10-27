# Appearing as a real camera in Zoom/Meet/Teams: the actual state of things

## Why macOS and Windows can't be "built" here, regardless of effort spent

Showing up as a selectable camera on these platforms means installing a
kernel-level driver — not a web technology, a different category of
software entirely:

- **macOS**: a CoreMediaIO DAL system extension. Since macOS 13, this
  requires (a) an active Apple Developer Program membership tied to a
  real identity/company ($99/year, only the account holder can enroll),
  (b) code-signing the extension with that identity's certificate, and
  (c) Apple's notarization service approving the signed binary, and (d)
  the end user manually approving it in System Settings > Privacy. Every
  one of those steps is gatekept by Apple to *your* Apple ID — I can
  write the Swift/Objective-C source for the extension, but I cannot
  enroll you in the Developer Program, sign it with your certificate, or
  get Apple to notarize it. Those aren't coding tasks.
- **Windows**: a DirectShow (or Media Foundation) virtual camera driver.
  Similarly needs driver signing through Microsoft's Hardware Dev Center,
  tied to a real developer account.

No amount of "build it fast" changes this — it's not a time or effort
constraint, it's that the remaining steps are identity-verification
processes that can only be completed by the account owner, on their own
machine, with their own credentials. If you want to pursue this
seriously, the realistic path is either (a) go through that
enrollment/signing process yourself with source code I can help write,
or (b) use the existing OBS Browser Source workaround already documented
in `docs/VIRTUAL_CAMERA_SETUP.md`, which works today with zero signing.

## Linux is different — and this one IS real, buildable code

Linux's `v4l2loopback` is an open-source kernel module anyone can build
and load locally — no vendor, no signing, no gatekeeping. That makes a
real bridge possible without any of the blockers above.

### How it works
1. Genesis's canvas output becomes a `MediaStream` via
   `canvas.captureStream()` (already how recording works).
2. That stream is sent over a local WebSocket to a small bridge script
   running on the same machine.
3. The bridge pipes incoming frames into `ffmpeg`, which writes them to
   a `/dev/videoN` device created by `v4l2loopback`.
4. Zoom/Meet/Teams see that `/dev/videoN` as a normal webcam.

### Setup

```bash
sudo apt install v4l2loopback-dkms ffmpeg
sudo modprobe v4l2loopback video_nr=10 card_label="Genesis" exclusive_caps=1
```

Then run the bridge (see `server/camera-bridge.js`):
```bash
cd server
node camera-bridge.js
```

In Genesis, open `studio.html?action=bridge` (the bridge control appears
in the Live panel once `server/camera-bridge.js` is running and reachable
at `ws://localhost:8790`), and in Zoom/Meet, select "Genesis" as your
camera.

### Honest status of this specific piece

**This code has not been run end-to-end in the sandbox this was built
in** — there's no GUI browser, no kernel module loader, and no physical
camera device available here to test against. It's written correctly
against the real APIs (`v4l2loopback`, `ffmpeg`'s `-f v4l2` output, and
standard `MediaStream`/WebSocket browser APIs), but please verify it on
your own Linux machine before relying on it, the same way you'd verify
any new dependency. If something doesn't connect, the first things to
check are: is the kernel module actually loaded (`lsmod | grep
v4l2loopback`), is `/dev/video10` present, and is `ffmpeg` receiving
data (add `-loglevel verbose` temporarily).
