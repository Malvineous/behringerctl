# Behringer Ultracurve Pro DEQ2496

## Hardware

* 2x ADSP-21065L "SHARC" - DSPs ([PDF](https://www.analog.com/media/en/technical-documentation/data-sheets/ADSP-21065L.pdf))
* ADSP-BF531 "Blackfin" - microcontroller ([PDF](https://www.analog.com/media/en/technical-documentation/data-sheets/ADSP-BF531_BF532_BF533.pdf))
* ISSI IC42S16100E-7TL - 2 MB SDRAM (512K * 16-bit * 2-bank = 16Mbit)
* SST39SF040 - 512 kB flash
* AK5393VS - ADC, 24 bit 1 kHz to 108 kHz I²S
* AK4393VF - DAC, 24-bit 108 kHz I²S
* AK4524 - 24-bit 96 kHz audio codec with differential outputs
* AK4114 - AES3/SPDIF transceiver

## Additional functions

* Holding the COMPARE and MEMORY buttons while powering on the device will
  perform a factory reset. (Manual says holding MEMORY is enough)

* Holding the UTILITY button while powering on the device will enter the
  bootloader (see below).  Power cycle it again to return to normal operation.

### Bugs

#### Firmware 2.5

* You can use the `setMIDIChannel` command to set a channel up to 128, even
  though channels above 16 are invalid.  When a channel above 16 is set, the
  device only responds to device ID 1.

* The `getScreenshot` command returns 7 bytes short, so the last 49 pixels of
  the screenshot are missing.  Most screens don't use the last row of pixels
  so it's not noticeable.  You can however see it on RTA page 3.

* The `getSinglePreset` command seems to return incomplete data, as the preset
  title is truncated to 10 characters.  Writing a preset can set a title longer
  than 10 characters however.

## Bootloader

The bootloader can be used to reflash the firmware, even if a previous flash
was unsuccessful (as long as the part of the flash holding the bootloader was
untouched).  The official firmware images never appear to touch the boot loader
so these should never brick the device.

In the bootloader, the device responds over MIDI to a subset of the normal
functions.  It also identifies itself with the model `DEQ2496V2 BOOTLOAD`
rather than the usual `DEQ2496`.

## Flash layout

This differs from the official SysEx doc.  Perhaps the doc is for hardware V1.

* 0x00000 - 0x03FFF (16 kB): Bootloader
* 0x04000 - 0x73FFF (448 kB): Application, only 0x4000-0x5B000 (348 kB) is used
* 0x74000 - 0x7BFFF (32 kB): User presets
* 0x7C000 - 0x7DFFF (8 kB): Scratch space (contains old presets)
* 0x7E000 - 0x7FFFF (8 kB): Hardware config data (does not differ between units)

The application segment is the only part reflashed by the official firmware
releases, which means if the process fails, the bootloader will be left intact
so further attempts at reflashing are possible.

## Encryption

### Run time

There is a lot of obfuscation of the firmware, however it is all done with
simple XOR ciphers so it is for the most part trivial to undo.

The application segment in the firmware is XOR encrypted, and this is decrypted
by the bootloader during startup.  The decryption key is itself encrypted within
the bootloader code:

* Offset 0x3002, length 0x38: Bootloader key
* Offset 0x303A, length 0x38: Application key, encrypted with bootloader key

The application key can be recovered by XORing it with the bootloader key, which
reveals `- ORIGINAL BEHRINGER CODE - COPYRIGHT 2004 - BGER/TZ - ` (note trailing
space).

This cleartext application key must then be XOR'd over the data in the
application segment to reveal the cleartext application code.

### Reflash

When the firmware is reflashed via the MIDI interface, multiple levels of
encryption are again used.  The process happens as follows:

1. The device receives a MIDI SysEx event number 0x34 ("write firmware block").

2. The 7-bit SysEx data is converted back to 8-bit data, by taking every eighth
   byte and using its bits as the MSB bits of the preceeding seven bytes.  Thus
   every eight bytes in the SysEx event produce seven usable bytes.  See
   sevenEightCoder.js for example code.

3. An XOR cipher with the key `TZ'04` is applied to the data block to decode it.

4. The block structure is now a UINT16BE block number, then a UINT8 crc,
   followed by 256 bytes of data.

5. The CRC byte is checked.  The algorithm is currently unknown.

6. The devices stores the 256 bytes into memory (not flash) and does not
   respond yet.

7. After the 16th block has been received (4 kB) another XOR algorithm is
   applied to the 4 kB block as a whole.  This algorithm is also currently
   unknown, but it works at the 16-bit word level rather than at the byte level.
   The key starts with `(blockNumber / 0x1000 + 2) ^ 0x4002` and after every
   16-bit value, the key is shifted right by one bit.

8. The 4 kB block is then written to the flash chip and an acknowledgement is
   sent back as a SysEx event.

Writing to the special block number 0xFF00 causes the device to display the
ASCII content on the LCD screen.  The stock firmware image contains extra blocks
at the beginning and end of the firmware data to write messages indicating the
process is beginning and has completed.