## Description

This is a command-line utility that can send commands to supported Behringer
devices over a MIDI interface.

It can also be used as a module (for which the CLI is an example) should you
wish to control Behringer devices in your own NodeJS programs.

## Supported devices

### DEQ2496

* Working: Reading and writing presets, screenshots, MIDI channel changing
* Incomplete: Adjusting parameters (non SysEx), selecting
  different menu pages on the LCD, firmware upload

### Others

Other Behringer devices should be able to be identified, however none of their
functions will work unless they are shared with a supported device.
Contributions are welcome if anyone wishes to add support for additional
devices!

## Installation

    npm install -g behringerctl

## Use

First, identify which MIDI ports you have available:

    behringerctl midi list

If the selected devices are not correct, you'll need to specify which MIDI
interface to use on each subsequent command:

    behringerctl --midi-in 2 --midi-out 5 ...

This will be omitted to keep the examples clear so specify it if you need to.

Next, see if you have any supported devices:

    behringerctl devices list

This will take some time as it waits for a few seconds to give every device a
chance to respond.  If you see devices listed, take note of the device ID as
you will need to specify it in further commands, like this:

    behringerctl --device-id 0 ...

You may now be specifying `--midi-in`, `--midi-out` and `--device-id` on every
single command!

You can now send commands to this device:

    # Get same model name returned by `devices list`
    behringerctl --device-id 0 devices identify

    # Dump screen contents if you have a large enough terminal window
    behringerctl --device-id 0 screenshot show

    # Set MIDI channel from 1 (device ID 0) to 4 (device ID 3)
    behringerctl --device-id 0 devices config --midi-channel 4

    # Set MIDI channel back to 1 (device ID 0)
    behringerctl --device-id 3 devices config --midi-channel 1

Be aware that changing the MIDI channel also changes the device ID, which is
always one integer less than the MIDI channel.

The available commands are listed in the help:

    behringerctl help
    behringerctl help devices config

### Examples

Export all the presets from one DEQ2496 and import them into another (or back
into the same unit after a factory reset):

    behringerctl --device-id 0 presets export --index 0 --count 65 --prefix preset
    behringerctl --device-id 1 presets import --index 0 --count 65 --prefix preset

Note that at the time of writing the 16-character preset titles will be
truncated to 10 characters during the export due to a firmware bug.  You can
edit the exported files in a hex editor and add back the missing characters to
the end of the file, which will then reimport with the full title.

## Use as a module

See `cli/index.js` to get started.

## Notes

### General

* If you change the MIDI channel with `setMIDIChannel`, you will also be
  changing the `deviceId`, so you'll need to use the new value (minus 1) for
  subsequent commands sent to the same device.

### DEQ2496

* Holding the COMPARE and MEMORY buttons while powering on the device will
  perform a factory reset.
* To access the bootloader, hold the UTILITY button while powering on the
  device.  (Power cycle it again to return to normal).  In the bootloader, the
  device responds over MIDI but identifies itself with the model
  `DEQ2496V2 BOOTLOAD` rather than the usual `DEQ2496`.

#### Bugs

##### Firmware 2.5

* You can use the `setMIDIChannel` command to set a channel up to 128, even
  though channels above 16 are invalid.
* The `getScreenshot` command returns 7 bytes short, so the last 49 pixels of
  the screenshot are missing.  Most screens don't use the last row of pixels
  so it's not noticeable.  You can however see it on RTA page 3.
* The `getSinglePreset` command seems to return incomplete data, as the preset
  title is truncated to 10 characters.  Writing a preset can set a title longer
  than 10 characters however.
