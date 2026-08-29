#import <AppKit/AppKit.h>
#import <dispatch/dispatch.h>
#import <ghostty.h>
#import <math.h>
#import <stdatomic.h>
#import <stdlib.h>
#import <time.h>
#import <unistd.h>

#import "libghostty_host.h"

typedef struct {
  ghostty_app_t app;
  ghostty_config_t config;
} MuxedGhosttyRuntime;

// Keep the compiled bridge as one Objective-C translation unit while each
// implementation file owns one concern.
#include "libghostty_surface_owner.m"
#include "libghostty_focus_trace.m"
#include "libghostty_runtime.m"
#include "libghostty_key_event.m"
#include "libghostty_studio_chord.m"
#include "libghostty_view.m"
#include "libghostty_command_routing.m"
#include "libghostty_view_bridge.m"
