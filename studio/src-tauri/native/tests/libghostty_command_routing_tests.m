#import <AppKit/AppKit.h>
#import <ghostty.h>
#import <stdbool.h>
#import <stdint.h>
#import <stdio.h>
#import <stdlib.h>

#include "../libghostty_host.h"
#include "../libghostty_surface_owner.m"

static ghostty_input_mods_e ghostty_mods(NSEventModifierFlags flags) {
  uint32_t mods = GHOSTTY_MODS_NONE;
  if (flags & NSEventModifierFlagShift) mods |= GHOSTTY_MODS_SHIFT;
  if (flags & NSEventModifierFlagControl) mods |= GHOSTTY_MODS_CTRL;
  if (flags & NSEventModifierFlagOption) mods |= GHOSTTY_MODS_ALT;
  if (flags & NSEventModifierFlagCommand) mods |= GHOSTTY_MODS_SUPER;
  if (flags & NSEventModifierFlagCapsLock) mods |= GHOSTTY_MODS_CAPS;
  return (ghostty_input_mods_e)mods;
}

#include "../libghostty_key_event.m"

static ghostty_surface_t binding_surface = NULL;
static uint16_t binding_key_code = 0;
static size_t binding_query_count = 0;
static ghostty_surface_t last_queried_surface = NULL;
static ghostty_input_key_s last_queried_key = {0};
static size_t forwarded_key_count = 0;
static ghostty_surface_t last_forwarded_surface = NULL;
static size_t reported_chord_count = 0;
static uint8_t last_reported_chord = MUXED_GHOSTTY_CHORD_NONE;

uint8_t muxed_ghostty_studio_chord(uint64_t modifier_flags,
                                   uint16_t key_code) {
  NSEventModifierFlags chord =
      modifier_flags & (NSEventModifierFlagControl | NSEventModifierFlagCommand |
                        NSEventModifierFlagOption | NSEventModifierFlagShift);
  return chord == NSEventModifierFlagCommand && key_code == 0x13
             ? MUXED_GHOSTTY_CHORD_MODULE_POSITION_2
             : MUXED_GHOSTTY_CHORD_NONE;
}

bool ghostty_surface_key_is_binding(ghostty_surface_t surface,
                                    ghostty_input_key_s key,
                                    ghostty_binding_flags_e *flags) {
  binding_query_count++;
  last_queried_surface = surface;
  last_queried_key = key;
  if (flags != NULL) *flags = GHOSTTY_BINDING_FLAGS_PERFORMABLE;
  return surface == binding_surface && key.keycode == binding_key_code;
}

bool ghostty_surface_key(ghostty_surface_t surface, ghostty_input_key_s key) {
  (void)key;
  forwarded_key_count++;
  last_forwarded_surface = surface;
  return true;
}

@interface MuxedTestWindow : NSObject
@property(nonatomic, assign) NSResponder *firstResponder;
@end

@implementation MuxedTestWindow
@end

@interface MuxedGhosttyView : NSView {
 @public
  ghostty_surface_t _surface;
  muxed_ghostty_surface_owner_s _surfaceOwner;
  BOOL _acceptsInput;
  MuxedTestWindow *_testWindow;
}
@end

@implementation MuxedGhosttyView

- (NSWindow *)window {
  return (NSWindow *)_testWindow;
}

- (void)keyDown:(NSEvent *)event {
  uint8_t chord = muxed_ghostty_studio_chord(event.modifierFlags, event.keyCode);
  if (chord != MUXED_GHOSTTY_CHORD_NONE) {
    reported_chord_count++;
    last_reported_chord = chord;
    return;
  }
  ghostty_input_key_s key = muxed_ghostty_key_event(
      event, event.isARepeat ? GHOSTTY_ACTION_REPEAT : GHOSTTY_ACTION_PRESS);
  ghostty_surface_key(_surface, key);
}

@end

#include "../libghostty_command_routing.m"

static void require(bool condition, const char *message) {
  if (condition) return;
  fprintf(stderr, "%s\n", message);
  exit(1);
}

static NSEvent *key_event(uint16_t key_code, NSEventModifierFlags modifiers,
                          NSString *characters,
                          NSString *characters_ignoring_modifiers) {
  return [NSEvent keyEventWithType:NSEventTypeKeyDown
                          location:NSZeroPoint
                     modifierFlags:modifiers
                         timestamp:0
                      windowNumber:0
                           context:nil
                        characters:characters
       charactersIgnoringModifiers:characters_ignoring_modifiers
                         isARepeat:NO
                           keyCode:key_code];
}

int main(void) {
  @autoreleasepool {
    int surface_storage[2] = {0};
    ghostty_surface_t first_surface = (ghostty_surface_t)&surface_storage[0];
    ghostty_surface_t second_surface = (ghostty_surface_t)&surface_storage[1];
    MuxedTestWindow *window = [MuxedTestWindow new];
    MuxedGhosttyView *first = [MuxedGhosttyView new];
    MuxedGhosttyView *second = [MuxedGhosttyView new];
    NSResponder *web_view = [NSResponder new];

    first->_testWindow = window;
    second->_testWindow = window;
    first->_acceptsInput = YES;
    second->_acceptsInput = YES;
    first->_surface = first_surface;
    second->_surface = second_surface;
    muxed_ghostty_surface_owner_init(&first->_surfaceOwner, first);
    muxed_ghostty_surface_owner_init(&second->_surfaceOwner, second);
    muxed_ghostty_surface_owner_activate(&first->_surfaceOwner, first_surface);
    muxed_ghostty_surface_owner_activate(&second->_surfaceOwner, second_surface);

    NSEvent *zoom = key_event(
        0x18, NSEventModifierFlagCommand | NSEventModifierFlagShift, @"+", @"=");
    NSEvent *quit = key_event(0x0C, NSEventModifierFlagCommand, @"q", @"q");
    NSEvent *module_two =
        key_event(0x13, NSEventModifierFlagCommand, @"2", @"2");

    window.firstResponder = first;
    binding_surface = first_surface;
    binding_key_code = zoom.keyCode;
    require([first performKeyEquivalent:zoom],
            "the focused surface declined its bound Cmd++ event");
    require(binding_query_count == 1 && last_queried_surface == first_surface,
            "the binding query did not use the focused surface");
    require(last_queried_key.keycode == zoom.keyCode &&
                (last_queried_key.mods & GHOSTTY_MODS_SUPER) != 0 &&
                (last_queried_key.mods & GHOSTTY_MODS_SHIFT) != 0 &&
                last_queried_key.unshifted_codepoint == '=',
            "Cmd++ was not translated into Ghostty's pinned key shape");
    require(forwarded_key_count == 1 &&
                last_forwarded_surface == first_surface,
            "the bound event did not reach its Ghostty surface");

    require(![first performKeyEquivalent:quit],
            "an unbound application command was consumed");
    require(binding_query_count == 2 && forwarded_key_count == 1,
            "an unbound application command reached Ghostty");

    size_t before_module_binding_query = binding_query_count;
    size_t before_module_forward = forwarded_key_count;
    require([first performKeyEquivalent:module_two],
            "the focused surface declined Cmd+2");
    require(reported_chord_count == 1 &&
                last_reported_chord ==
                    MUXED_GHOSTTY_CHORD_MODULE_POSITION_2,
            "Cmd+2 was not reported as module position 2");
    require(binding_query_count == before_module_binding_query &&
                forwarded_key_count == before_module_forward,
            "a Studio module chord reached Ghostty's binding path");

    size_t before_unfocused = binding_query_count;
    window.firstResponder = web_view;
    size_t before_unfocused_chord = reported_chord_count;
    require(![first performKeyEquivalent:module_two],
            "an unfocused native view claimed the WebView's Cmd+2");
    require(reported_chord_count == before_unfocused_chord,
            "an unfocused native view duplicated module navigation");
    require(![first performKeyEquivalent:zoom],
            "an unfocused retained viewer claimed a key equivalent");
    require(binding_query_count == before_unfocused,
            "an unfocused retained viewer queried its surface");

    window.firstResponder = second;
    binding_surface = second_surface;
    require([second performKeyEquivalent:zoom],
            "the second focused surface declined its binding");
    require(last_queried_surface == second_surface &&
                last_forwarded_surface == second_surface,
            "multiple viewers routed through the wrong surface");

    size_t before_teardown = binding_query_count;
    window.firstResponder = first;
    muxed_ghostty_surface_owner_invalidate(&first->_surfaceOwner);
    require(![first performKeyEquivalent:zoom],
            "an invalidated owner claimed a key equivalent");
    require(binding_query_count == before_teardown,
            "an invalidated owner queried a stale surface pointer");

    window.firstResponder = second;
    require([second performKeyEquivalent:zoom],
            "invalidating one owner affected the other surface");

    first->_testWindow = nil;
    second->_testWindow = nil;
    [first release];
    [second release];
    [web_view release];
    [window release];
  }

  return 0;
}
