// Exact Studio chord recognition for a focused native Ghostty view.

static const uint16_t kMuxedEscapeKeyCode = 0x35;
static const uint16_t kMuxedGraveKeyCode = 0x32;
static const uint16_t kMuxedEKeyCode = 0x0E;

// Hardware positions for 1 through 9, followed by 0, on a Mac keyboard.
static const uint16_t kMuxedModulePositionKeyCodes[] = {
    0x12, 0x13, 0x14, 0x15, 0x17, 0x16, 0x1A, 0x1C, 0x19, 0x1D,
};

uint8_t muxed_ghostty_studio_chord(uint64_t modifier_flags,
                                   uint16_t key_code) {
  NSEventModifierFlags chord =
      modifier_flags & (NSEventModifierFlagControl | NSEventModifierFlagCommand |
                        NSEventModifierFlagOption | NSEventModifierFlagShift);
  if (key_code == kMuxedGraveKeyCode && chord == NSEventModifierFlagControl) {
    return MUXED_GHOSTTY_CHORD_PANEL_TOGGLE;
  }
  if (key_code == kMuxedEKeyCode && chord == NSEventModifierFlagCommand) {
    return MUXED_GHOSTTY_CHORD_SETTINGS;
  }
  if (key_code == kMuxedEscapeKeyCode &&
      chord == NSEventModifierFlagCommand) {
    return MUXED_GHOSTTY_CHORD_BODY_DISENGAGE;
  }
  if (chord == NSEventModifierFlagCommand) {
    for (uint8_t index = 0; index < 10; index++) {
      if (key_code == kMuxedModulePositionKeyCodes[index]) {
        return MUXED_GHOSTTY_CHORD_MODULE_POSITION_1 + index;
      }
    }
  }
  return MUXED_GHOSTTY_CHORD_NONE;
}
