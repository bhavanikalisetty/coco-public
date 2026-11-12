# Coco

Coco is a conference companion prototype for the web and the M5Stack StickS3 badge. The web preview includes a fictional conference, attendee profiles, and a session schedule.

```sh
cd apps/web
npm ci
npm run dev
```

The preview has no connected backend. Account sign-in, live chat, recordings, badge sync, and external integrations require a separate backend and do not work in this release.

The badge firmware ships with networking disabled. To build it with PlatformIO, run `pio run --project-dir firmware`. Run the portable C++ tests with `python3 firmware/scripts/test_native.py`. See the [vendor notes](firmware/docs/VENDOR.md) for the bundled NFC library.
