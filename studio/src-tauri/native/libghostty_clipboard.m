// Native clipboard integration for each owned Ghostty surface.

#import <string.h>

static NSPasteboard *muxed_ghostty_pasteboard(
    ghostty_clipboard_e clipboard) {
  if (clipboard != GHOSTTY_CLIPBOARD_STANDARD) return nil;
  return [NSPasteboard generalPasteboard];
}

static const ghostty_clipboard_content_s *muxed_ghostty_plain_text_content(
    const ghostty_clipboard_content_s *content, size_t count) {
  if (content == NULL) return NULL;
  for (size_t index = 0; index < count; index++) {
    if (content[index].mime != NULL && content[index].data != NULL &&
        strcmp(content[index].mime, "text/plain") == 0)
      return &content[index];
  }
  return NULL;
}

static bool muxed_ghostty_read_pasteboard(void *userdata,
                                          NSPasteboard *pasteboard,
                                          void *state) {
  ghostty_surface_t surface = muxed_ghostty_owned_surface(userdata);
  if (surface == NULL || pasteboard == nil || state == NULL) return false;

  NSString *value = [pasteboard stringForType:NSPasteboardTypeString];
  if (value == nil) return false;
  const char *utf8 = value.UTF8String;
  if (utf8 == NULL) return false;

  ghostty_surface_complete_clipboard_request(surface, utf8, state, false);
  return true;
}

static bool muxed_ghostty_write_pasteboard(
    NSPasteboard *pasteboard, const ghostty_clipboard_content_s *content,
    size_t count) {
  const ghostty_clipboard_content_s *plain_text =
      muxed_ghostty_plain_text_content(content, count);
  if (pasteboard == nil || plain_text == NULL) return false;

  NSString *value = [NSString stringWithUTF8String:plain_text->data];
  if (value == nil) return false;
  [pasteboard clearContents];
  return [pasteboard setString:value forType:NSPasteboardTypeString];
}

static NSModalResponse muxed_ghostty_confirm_clipboard_request(
    ghostty_clipboard_request_e request) {
  NSAlert *alert = [[NSAlert alloc] init];
  switch (request) {
    case GHOSTTY_CLIPBOARD_REQUEST_PASTE:
      alert.messageText = @"Paste text into the terminal?";
      alert.informativeText =
          @"The clipboard contains text that Ghostty marked for confirmation.";
      [alert addButtonWithTitle:@"Paste"];
      break;
    case GHOSTTY_CLIPBOARD_REQUEST_OSC_52_READ:
      alert.messageText = @"Allow terminal clipboard access?";
      alert.informativeText =
          @"A terminal program requested the current clipboard contents.";
      [alert addButtonWithTitle:@"Allow"];
      break;
    case GHOSTTY_CLIPBOARD_REQUEST_OSC_52_WRITE:
      alert.messageText = @"Allow terminal to change the clipboard?";
      alert.informativeText =
          @"A terminal program requested permission to write clipboard text.";
      [alert addButtonWithTitle:@"Allow"];
      break;
  }
  [alert addButtonWithTitle:@"Cancel"];
  NSModalResponse response = [alert runModal];
  [alert release];
  return response;
}

static bool runtime_read_clipboard(void *userdata,
                                   ghostty_clipboard_e clipboard,
                                   void *state) {
  return muxed_ghostty_read_pasteboard(
      userdata, muxed_ghostty_pasteboard(clipboard), state);
}

static void runtime_confirm_clipboard(
    void *userdata, const char *value, void *state,
    ghostty_clipboard_request_e request) {
  void (^confirm)(void) = ^{
    ghostty_surface_t surface = muxed_ghostty_owned_surface(userdata);
    if (surface == NULL || state == NULL) return;

    bool accepted = value != NULL &&
                    muxed_ghostty_confirm_clipboard_request(request) ==
                        NSAlertFirstButtonReturn;
    ghostty_surface_complete_clipboard_request(
        surface, accepted ? value : "", state, true);
  };
  if ([NSThread isMainThread])
    confirm();
  else
    dispatch_sync(dispatch_get_main_queue(), confirm);
}

static void runtime_write_clipboard(
    void *userdata, ghostty_clipboard_e clipboard,
    const ghostty_clipboard_content_s *content, size_t count, bool confirm) {
  (void)userdata;
  NSPasteboard *pasteboard = muxed_ghostty_pasteboard(clipboard);
  if (pasteboard == nil) return;

  void (^write)(void) = ^{
    if (confirm &&
        muxed_ghostty_confirm_clipboard_request(
            GHOSTTY_CLIPBOARD_REQUEST_OSC_52_WRITE) !=
            NSAlertFirstButtonReturn)
      return;
    muxed_ghostty_write_pasteboard(pasteboard, content, count);
  };
  if ([NSThread isMainThread])
    write();
  else
    dispatch_sync(dispatch_get_main_queue(), write);
}
