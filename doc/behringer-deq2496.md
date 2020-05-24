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

* Holding the MEMORY button while powering on the unit will reset most of the
  settings back to the default, but it will keep the presets untouched.

* Holding the COMPARE and MEMORY buttons while powering on the device will ask
  whether you want to wipe all the presets.  You must press a button to confirm
  before the presets are wiped.

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
* 0x7E000 - 0x7FFFF (8 kB): Boot logo (320×80 1bpp bitmap, 3200 bytes)

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
reveals `- ORIGINAL BEHRINGER CODE - COPYRIGHT 2004 - BGER/TZ - \x00` (note
trailing space followed by a null byte).

This cleartext application key must then be XOR'd over the data in the
application segment to reveal the cleartext application code.

### Reflash

When the firmware is reflashed via the MIDI interface, multiple levels of
encryption are again used.  The process happens as follows:

1. The device receives a MIDI SysEx event number 0x34 ("write firmware block").

2. The 7-bit SysEx data is converted back to 8-bit data, by taking every eighth
   byte and using its bits as the MSB bits of the preceeding seven bytes.  Thus
   every eight bytes in the SysEx event produce seven usable bytes.  See
   [sevenEightCoder.js](https://github.com/Malvineous/behringerctl/blob/master/algo/sevenEightCoder.js)
   for example code.

3. An XOR cipher with the key `TZ'04` is applied to the data block to decode it.

4. The block structure is now a UINT16BE block number, then a UINT8 crc,
   followed by 256 bytes of data.

5. The checksum byte is checked.  The Behringer docs call this a CRC but in
   reality it's a homebrew checksum.  See [checksumTZ.js](https://github.com/Malvineous/behringerctl/blob/master/algo/checksumTZ.js)
   for how to calculate it.  Contrary to the Behringer docs, the block number
   is not included in the checksum and only the 256 data bytes are used.

6. The devices stores the 256 bytes into memory (not flash) and does not
   respond yet.

7. After the 16th block has been received (4 kB) another XOR cipher is applied
   to the 4 kB block as a whole.  This algorithm uses the block's destination
   flash address as the key, rotating the key and flipping some of its bits as
   it goes.  Unlike the earlier ciphers this one works at the 16-bit level
   rather than at the byte level.  See
   [midiFirmwareCoder.js](https://github.com/Malvineous/behringerctl/blob/master/algo/midiFirmwareCoder.js)
   for the implementation.

8. The 4 kB block is then written to the flash chip and an acknowledgement is
   sent back as a SysEx event, and a message is shown on the LCD.

9. Note that the 4 kB block actually written to flash is still encrypted, as the
   bootloader decrypts it when copying the data from flash into RAM at boot up.

Writing to the special block number 0xFF00 causes the device to display the
ASCII content on the LCD screen.  The stock firmware image contains extra blocks
at the beginning and end of the firmware data to write messages indicating the
process is beginning and has completed.  When flashing from within the
application, the message gets overwritten during the flash process as each 4 kB
block written to flash causes a message with the block number to be displayed
on the LCD, overwriting the previous message.  When flashing from the bootloader
however, the message remains visible as a graphical representation of the blocks
being flashed is shown instead, which does not overwrite the last message.  Thus
with some creativity, one could write progress messages throughout the firmware
image such that a progress meter or "percentage flashed so far" information is
shown throughout the procedure.

## Firmware dumps

### Images

When extracting firmware images, the official firmware releases typically only
update the 'application' portion of the flash chip, leaving the areas in the
flash storing the bootloader and user presets unchanged.

When dumping one of these images through the CLI with the `firmware examine`
command, there are a few options:

```
Index     Offset  Available       Used   % Image name
   -1        0x0     524288     524288 100 (raw dump of flash chip content, see docs)
    0     0x4000     458752     356352  78 Application (raw)
    1     0x4000     458752     356352  78 Application (decrypted)
```

Extracting image 0 will write the same data to a file that would be written to
the flash chip, except that the data will be written to the start of the file
(offset 0) but it would go into the flash chip beginning at offset 0x4000, just
after the bootloader code.

Extracting image 1 will do the same, however a decryption will be performed to
reveal the cleartext code.  This data is not written to the flash, but at power
on, the bootloader performs this decryption when it copies the application code
into RAM.  So the data written to the file in this case is what ends up in the
device's memory, being executed by the processor.  If you intend to disassemble
the code, this is the image to use.

Image -1 will provide a full dump the size of the flash chip, with any missing
blocks filled with `0xFF` bytes, to simulate empty flash blocks.  This will
result in the application data at offset 0x4000 being written to offset 0x4000
in the file (and it will be encrypted, just as it is in the real flash chip),
however any data missing from the source file (e.g. the bootloader code itself)
will be replaced with 0xFF bytes in the output file.  Although the output file
will be the same size as the flash chip, be careful not to flash this if there
are missing sections, otherwise you will erase the bootloader and the device
will no longer function, until an EEPROM programmer is used to reflash the
missing bootloader.

If you have a full firmware dump of the flash chip taken with an EEPROM reader,
then image -1 will just give you the same file back again unchanged.

### Disassembly

To disassemble the code, a Blackfin disassembler is needed.  The GNU GCC project
used to have support for the Blackfin ISA, however this is now discontinued.
An older version of GCC can still be used to disassemble the code however, and
a Docker container exists to make this process very painless.

Once you have Docker installed and the ability to run containers, load the
`pf0camino/cross-bfin-elf` container:

    docker run -p 1222:22 -v /home/user/blackfin-projects/:/projects/ --rm=true pf0camino/cross-bfin-elf

Replace `/home/user/blackfin-projects/` with a path on the host machine where
data will be shared with the Docker container.  The firmware files can be put
in this folder on the host, where the disassember in the Docker container can
read them.  The disassembly output inside Docker will also be written here,
where it can be accessed on the host machine as well, even after the Docker
container has been terminated.

In another shell, connect to the container via SSH:

    ssh user@localhost -p 1222
    cd /projects

The default password is `secret`.

To disassemble a raw firmware dump, copy the file into the project folder and
then inside Docker, use the `objdump` command:

    bfin-elf-objdump -D -b binary -mbfin bootloader.bin > bootloader.disasm

To compile your own code (untested) you should be able to do something like
this:

    bfin-elf-gcc -mcpu=bf531 -o example.elf example.cpp
    bfin-elf-objcopy -I elf32-bfin -O binary example.elf example.bin

You will need to encrypt the binary before flashing it to the chip.

### Bootloader

The bootloader isn't a raw image file but a kind of container holding multiple
images (like a .zip file but without any compression).  The Blackfin boot
sequence reads the headers in this data that dictate which blocks of data are
written to which memory address at power up.

The CLI can display these headers but not yet build a bootloader image from raw
files:

    behringerctl firmware examineBootloader --read bootloader.bin

    Entrypoint: 0xffa08000
    Index    Address       Size Flags
        0 0xff800000          4 IGNORE flash=8-bit
        1 0xffa08000        278
        2 0xffa08000          2 INIT
        3 0xff800000          4 IGNORE
        4 0x00408000      11024
        5 0x0040ab10      26492 ZEROFILL

For more information on the addresses and flags, refer to the section on booting
in the Blackfin architecture manual.

### LCD messages

A special SysEx message can be sent to the device to write a message to the LCD
screen.  This is used to write a message at the start and end of the firmware
update process (although strangely it is not used to give progress updates).

When examining a SysEx firmware image (*.syx), these messages are displayed of
the form `0="example", 10="test"` which means `example` is written to the LCD
screen before any firmware blocks are sent, and `test` is written to the screen
after the 10th block has been sent.  Here, a block is defined as a single SysEx
message writing a 256-byte block of data.

## MIDI interface

### SysEx

The official Behringer document is mostly correct, although it's for the
DEQ2496v1 rather than v2.

#### 0x26 Unknown

The device sends a response to this message.  Its purpose is currently unknown.

#### 0x27 Unknown

The device sends a response to this message.  Its purpose is currently unknown.

#### 0x28 Unknown

The device sends a response to this message.  Its purpose is currently unknown.

#### 0x2a Unknown

The device sends a response to this message.  Its purpose is currently unknown.

#### 0x36 Unknown

The device sends a response to this message.  Its purpose is currently unknown.

#### 0x35 writeFlashResponse

No parameters.

After the 16th 256-byte subblock has been written with `writeFlashBlock(0x34)`,
the 4 kB block is flashed to the flash chip and `writeFlashResponse(0x35)` is
returned on success.

#### 0x62 Unknown

This event's purpose is currently unknown.
