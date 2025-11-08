# KEF Connect for Homey

KEF Connect for Homey lets you control your KEF speakers directly from your smart home. Add your KEF devices to Homey, and automate everyday listening, and keep your setup elegant and responsive.

## Key features

**Power and volume:** Turn speakers on/off, set volume, and mute.

**Source selection:** Switch between Wi‑Fi, Bluetooth, Optical, Coaxial, Analog, TV, and USB.

**Room tuning (model-dependent):**

- LS50 Wireless II, LS60 Wireless: Bass Extension, Desk Mode, Wall Mode, Balance.
- LSX II, LSX II LT, XIO: Core controls and source selection.

## Supported devices

- KEF LS50 Wireless II
- KEF LS60 Wireless
- KEF LSX II
- KEF LSX II LT
- KEF XIO

## Getting started

1. Install the app from the Homey App Store.
2. Add a device: choose your KEF model and enter its IP address.
3. Optional: open the device's settings to adjust:
   - IP address and port (default 80)
   - Polling interval (default 5 seconds)
   - View device info like model, firmware version, and last connected time

## Example Flow ideas

- **Wake and play:** When you arrive home, turn on speakers and set source to TV or Wi‑Fi.
- **Night mode:** At bedtime, reduce volume.
- **Quick switch:** On button press, toggle between TV and Bluetooth.

## Troubleshooting

- Make sure the speaker is reachable on your network (TCP port 80).
- If you change the speaker's IP, update it in the device settings.
- Reduce the polling interval if you need quicker state updates; increase if you prefer lighter network usage.

## Feedback & Support

Share ideas, report issues, and request features here on the community forum thread. Diagnostics help a lot when tracking down issues.
