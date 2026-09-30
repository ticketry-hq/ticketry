// Opaque, non-reused handles for commands queued across native view teardown.
// The dictionary owns each live view. A detached handle never resolves to a
// new view, even when AppKit reuses the old view's address.
#import <Foundation/Foundation.h>
#import <dispatch/dispatch.h>
#import <stdint.h>

static NSMutableDictionary *muxed_ghostty_live_views(void) {
  static NSMutableDictionary *views;
  static dispatch_once_t once;
  dispatch_once(&once, ^{ views = [[NSMutableDictionary alloc] init]; });
  return views;
}

// Takes ownership of the caller's +1 reference.
static void *muxed_ghostty_register_view(id view) {
  if (view == nil) return NULL;
  static uintptr_t next = 1;
  NSMutableDictionary *views = muxed_ghostty_live_views();
  @synchronized(views) {
    uintptr_t handle = next++;
    [views setObject:view forKey:@(handle)];
    [view release];
    return (void *)handle;
  }
}

// Returns a +1 reference. The redraw waiter uses this off the main thread,
// keeping its atomic generation counter alive while detach retires the view.
static id muxed_ghostty_retain_view(void *handle) {
  @autoreleasepool {
    NSMutableDictionary *views = muxed_ghostty_live_views();
    @synchronized(views) {
      return [[views objectForKey:@((uintptr_t)handle)] retain];
    }
  }
}

// Main-thread bridge commands run inside AppKit's autorelease pool.
static id muxed_ghostty_view_for_handle(void *handle) {
  return [muxed_ghostty_retain_view(handle) autorelease];
}

static void muxed_ghostty_release_view_on_main_thread(id view) {
  if ([NSThread isMainThread]) {
    [view release];
  } else {
    dispatch_async(dispatch_get_main_queue(), ^{ [view release]; });
  }
}

// Invalidates the handle before teardown can emit callbacks. Returns +1.
static id muxed_ghostty_take_view(void *handle) {
  NSMutableDictionary *views = muxed_ghostty_live_views();
  @synchronized(views) {
    NSNumber *key = @((uintptr_t)handle);
    id view = [[views objectForKey:key] retain];
    [views removeObjectForKey:key];
    return view;
  }
}
