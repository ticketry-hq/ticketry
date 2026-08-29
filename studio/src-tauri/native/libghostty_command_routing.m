// Command-key first refusal for the focused Ghostty view.

@implementation MuxedGhosttyView (CommandRouting)

- (BOOL)performKeyEquivalent:(NSEvent *)event {
  ghostty_surface_t surface = muxed_ghostty_owned_surface(&_surfaceOwner);
  if (!_acceptsInput || surface == NULL || surface != _surface ||
      muxed_ghostty_owned_viewer(&_surfaceOwner) != self ||
      event.type != NSEventTypeKeyDown ||
      !(event.modifierFlags & NSEventModifierFlagCommand))
    return NO;

  // NSWindow asks the whole view tree for key equivalents. A retained viewer
  // must not claim a binding before AppKit reaches the active terminal.
  if (self.window.firstResponder != self) return NO;

  // Studio-owned Command chords bypass Ghostty's binding table. The focused
  // view reports them once; when the WebView owns focus this view returns NO
  // above and the ordinary React keydown route remains the only handler.
  if (muxed_ghostty_studio_chord(event.modifierFlags, event.keyCode) !=
      MUXED_GHOSTTY_CHORD_NONE) {
    [self keyDown:event];
    return YES;
  }

  ghostty_input_key_s key =
      muxed_ghostty_key_event(event, GHOSTTY_ACTION_PRESS);
  ghostty_binding_flags_e flags = 0;
  if (!ghostty_surface_key_is_binding(surface, key, &flags)) return NO;

  [self keyDown:event];
  return YES;
}

@end
