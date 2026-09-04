// NSTextInputClient composition forwarding for the hosted Ghostty view.

@interface MuxedGhosttyView (TextInput) <NSTextInputClient>
@end

@implementation MuxedGhosttyView (TextInput)

static NSString *muxed_ghostty_input_string(id value) {
  return [value isKindOfClass:[NSAttributedString class]]
             ? [(NSAttributedString *)value string]
             : (NSString *)value;
}

- (BOOL)hasMarkedText {
  return _markedText.length > 0;
}

- (NSRange)markedRange {
  return [self hasMarkedText] ? NSMakeRange(0, _markedText.length)
                              : NSMakeRange(NSNotFound, 0);
}

- (NSRange)selectedRange {
  return [self hasMarkedText] ? _markedSelectedRange
                              : NSMakeRange(NSNotFound, 0);
}

- (void)setMarkedText:(id)value
         selectedRange:(NSRange)selectedRange
       replacementRange:(NSRange)replacementRange {
  (void)replacementRange;
  if (!_acceptsInput || _surface == NULL) return;

  NSString *text = muxed_ghostty_input_string(value);
  [_markedText release];
  _markedText = [[NSMutableAttributedString alloc] initWithString:text];
  _markedSelectedRange = selectedRange;
  const char *utf8 = text.UTF8String;
  ghostty_surface_preedit(
      _surface, utf8,
      (uintptr_t)[text lengthOfBytesUsingEncoding:NSUTF8StringEncoding]);
}

- (void)unmarkText {
  [_markedText release];
  _markedText = nil;
  _markedSelectedRange = NSMakeRange(NSNotFound, 0);
  if (!_acceptsInput || _surface == NULL) return;
  ghostty_surface_preedit(_surface, "", 0);
}

- (NSArray<NSAttributedStringKey> *)validAttributesForMarkedText {
  return @[];
}

- (NSAttributedString *)attributedSubstringForProposedRange:(NSRange)range
                                                actualRange:(NSRangePointer)actualRange {
  if (![self hasMarkedText] || NSMaxRange(range) > _markedText.length)
    return nil;
  if (actualRange != NULL) *actualRange = range;
  return [_markedText attributedSubstringFromRange:range];
}

- (void)insertText:(id)value replacementRange:(NSRange)replacementRange {
  (void)replacementRange;
  if (!_acceptsInput || _surface == NULL) return;

  NSString *text = muxed_ghostty_input_string(value);
  if ([self hasMarkedText]) ghostty_surface_preedit(_surface, "", 0);
  [_markedText release];
  _markedText = nil;
  _markedSelectedRange = NSMakeRange(NSNotFound, 0);
  if (_keyTextAccumulator != nil) {
    [_keyTextAccumulator addObject:text];
    return;
  }
  const char *utf8 = text.UTF8String;
  ghostty_surface_text(
      _surface, utf8,
      (uintptr_t)[text lengthOfBytesUsingEncoding:NSUTF8StringEncoding]);
}

- (NSUInteger)characterIndexForPoint:(NSPoint)point {
  (void)point;
  return NSNotFound;
}

- (NSRect)firstRectForCharacterRange:(NSRange)range
                          actualRange:(NSRangePointer)actualRange {
  (void)range;
  if (actualRange != NULL) *actualRange = NSMakeRange(NSNotFound, 0);
  if (!_acceptsInput || _surface == NULL || self.window == nil)
    return NSZeroRect;

  double x = 0;
  double y = 0;
  double width = 0;
  double height = 0;
  ghostty_surface_ime_point(_surface, &x, &y, &width, &height);
  NSRect local =
      NSMakeRect(x, self.bounds.size.height - y, width, height);
  return [self.window convertRectToScreen:[self convertRect:local toView:nil]];
}

- (void)doCommandBySelector:(SEL)selector {
  (void)selector;
}

@end
