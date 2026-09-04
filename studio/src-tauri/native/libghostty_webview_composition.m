// CODING-1391 comparison spike for native Ghostty/WebView composition.
//
// Transparent WebKit content does not make WKWebView hit testing transparent.
// The reliable AppKit fallback is dynamic sibling ordering with
// addSubview:positioned:relativeTo:. Ghostty sits above WebKit while native
// terminal input is enabled and below it while a DOM overlay owns input.

static void muxed_ghostty_prepare_transparent_webview(NSView *webview) {
  if (webview == nil) return;
  // WKWebView's native background switch is a private KVC key, not an
  // Objective-C setter. This is the same path Wry's macOS transparency
  // implementation uses.
  [webview setValue:@NO forKey:@"drawsBackground"];
  if (@available(macOS 12.0, *)) {
    [webview setValue:NSColor.clearColor forKey:@"underPageBackgroundColor"];
  }
  webview.wantsLayer = YES;
  webview.layer.backgroundColor = NSColor.clearColor.CGColor;
  // Transparent DOM pixels expose this AppKit container. Match it to the
  // native terminal/pane color so padding and tab transitions do not flash
  // the NSWindow's default background.
  if (webview.superview != nil) {
    webview.superview.wantsLayer = YES;
    webview.superview.layer.backgroundColor =
        muxed_ghostty_background_color().CGColor;
  }
}

static bool muxed_ghostty_place_sibling(NSView *ghostty, NSView *webview,
                                        bool webview_owns_input) {
  if (ghostty == nil || webview == nil || webview.superview == nil ||
      ghostty == webview)
    return false;

  NSView *container = webview.superview;
  NSWindowOrderingMode order =
      webview_owns_input ? NSWindowBelow : NSWindowAbove;
  [container addSubview:ghostty positioned:order relativeTo:webview];
  return ghostty.superview == container;
}
