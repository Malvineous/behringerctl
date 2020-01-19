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

    # Set MIDI channel to 4
    behringerctl --device-id 0 devices config --midi-channel 4

    # Dump screen contents if you have a large enough terminal window
    behringerctl --device-id 0 screenshot show

Be aware that changing the MIDI channel also changes the device ID, which is
always one integer less than the MIDI channel.

## Notes

### General

* If you change the MIDI channel with `setMIDIChannel`, you will also be
  changing the `deviceId`, so you'll need to use the new value for subsequent
  commands sent to the same device.

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
  title is truncated to 10 characters.
