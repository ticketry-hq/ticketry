// AppKit owns composition before Ghostty can dispatch an explicit binding.
- (void)forwardKeyEvent:(NSEvent *)event {
  BOOL markedBefore = [self hasMarkedText];
  ghostty_input_key_s key = muxed_ghostty_key_event(
      event, event.isARepeat ? GHOSTTY_ACTION_REPEAT : GHOSTTY_ACTION_PRESS);
  // Preserve ordinary terminal control/Command protocols. During composition,
  // the input method still gets first refusal over those keys.
  if (!markedBefore &&
      (event.modifierFlags &
       (NSEventModifierFlagControl | NSEventModifierFlagCommand))) {
    ghostty_surface_key(_surface, key);
    return;
  }

  _keyInputOwned = markedBefore;
  _keyCommandRequested = NO;
  _keyTextAccumulator = [[NSMutableArray alloc] init];
  BOOL handled = [self.inputContext handleEvent:event];
  NSString *text = [_keyTextAccumulator componentsJoinedByString:@""];
  BOOL inputOwned = _keyInputOwned || [self hasMarkedText] ||
      (handled && !_keyCommandRequested && _keyTextAccumulator.count == 0);

  if (inputOwned) {
    // Ownership is sticky for this key, including commit/cancel callbacks that
    // clear marked text. The pinned core dispatches bindings before checking
    // `composing`, so an IME-owned key must never reach its binding lookup.
    if (text.length > 0)
      ghostty_surface_text(_surface, text.UTF8String,
          [text lengthOfBytesUsingEncoding:NSUTF8StringEncoding]);
  } else {
    if (text.length > 0) key.text = text.UTF8String;
    ghostty_surface_key(_surface, key);
  }
  [_keyTextAccumulator release];
  _keyTextAccumulator = nil;
}
