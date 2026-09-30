// Translate an AppKit key event into the pinned libghostty C API shape.

static ghostty_input_key_s muxed_ghostty_key_event(
    NSEvent *event, ghostty_input_action_e action) {
  ghostty_input_key_s key = {0};
  key.action = action;
  key.keycode = event.keyCode;
  key.mods = ghostty_mods(event.modifierFlags);
  key.consumed_mods =
      ghostty_mods(event.modifierFlags &
                   ~(NSEventModifierFlagControl | NSEventModifierFlagCommand));
  NSString *unshifted = [event charactersByApplyingModifiers:0];
  if (unshifted.length == 1)
    key.unshifted_codepoint = [unshifted characterAtIndex:0];

  NSString *text = event.characters;
  if (text.length == 1) {
    unichar scalar = [text characterAtIndex:0];
    if (scalar < 0x20 || (scalar >= 0xF700 && scalar <= 0xF8FF)) text = nil;
  }
  key.text = text.UTF8String;
  return key;
}
