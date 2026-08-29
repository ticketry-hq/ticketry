#import <AppKit/AppKit.h>
#import <stdbool.h>
#import <stdint.h>
#import <stdio.h>
#import <stdlib.h>

#include "../libghostty_host.h"
#include "../libghostty_studio_chord.m"

static void require(bool condition, const char *message) {
  if (condition) return;
  fprintf(stderr, "%s\n", message);
  exit(1);
}

int main(void) {
  const uint64_t control = NSEventModifierFlagControl;
  const uint64_t command = NSEventModifierFlagCommand;
  const uint64_t shift = NSEventModifierFlagShift;
  const uint64_t option = NSEventModifierFlagOption;
  const uint64_t caps_lock = NSEventModifierFlagCapsLock;
  const uint16_t number_keys[] = {
      0x12, 0x13, 0x14, 0x15, 0x17, 0x16, 0x1A, 0x1C, 0x19, 0x1D,
  };

  require(muxed_ghostty_studio_chord(command, 0x35) ==
              MUXED_GHOSTTY_CHORD_BODY_DISENGAGE,
          "exact Cmd+Escape did not map to body disengage");
  require(muxed_ghostty_studio_chord(command | caps_lock, 0x35) ==
              MUXED_GHOSTTY_CHORD_BODY_DISENGAGE,
          "Caps Lock changed the Cmd+Escape mapping");
  require(muxed_ghostty_studio_chord(0, 0x35) == MUXED_GHOSTTY_CHORD_NONE,
          "bare Escape was taken from the terminal");
  require(muxed_ghostty_studio_chord(command | shift, 0x35) ==
              MUXED_GHOSTTY_CHORD_NONE,
          "Cmd+Shift+Escape was treated as body disengage");
  require(muxed_ghostty_studio_chord(command | control, 0x35) ==
              MUXED_GHOSTTY_CHORD_NONE,
          "Cmd+Ctrl+Escape was treated as body disengage");
  require(muxed_ghostty_studio_chord(command | option, 0x35) ==
              MUXED_GHOSTTY_CHORD_NONE,
          "Cmd+Option+Escape was treated as body disengage");

  require(muxed_ghostty_studio_chord(control, 0x32) ==
              MUXED_GHOSTTY_CHORD_PANEL_TOGGLE,
          "the panel toggle mapping changed");
  require(muxed_ghostty_studio_chord(command, 0x0E) ==
              MUXED_GHOSTTY_CHORD_SETTINGS,
          "the Settings mapping changed");
  for (uint8_t index = 0; index < 10; index++) {
    require(muxed_ghostty_studio_chord(command, number_keys[index]) ==
                MUXED_GHOSTTY_CHORD_MODULE_POSITION_1 + index,
            "a Cmd+number module-position mapping changed");
    require(muxed_ghostty_studio_chord(0, number_keys[index]) ==
                MUXED_GHOSTTY_CHORD_NONE,
            "an unmodified number was taken from the terminal");
    require(muxed_ghostty_studio_chord(command | shift,
                                       number_keys[index]) ==
                MUXED_GHOSTTY_CHORD_NONE,
            "a shifted Cmd+number was treated as module navigation");
  }
  return 0;
}
