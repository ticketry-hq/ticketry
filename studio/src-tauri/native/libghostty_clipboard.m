// Per-surface ownership and text completion for Ghostty clipboard requests.

#import <stdint.h>
#import <string.h>

static const uint64_t kMuxedGhosttySurfaceOwnerMagic =
    0x5449434B45545259ULL;

typedef struct {
  uint64_t magic;
  ghostty_surface_t surface;
  void *viewer;
  bool available;
} muxed_ghostty_surface_owner_s;

static const muxed_ghostty_surface_owner_s *
muxed_ghostty_surface_owner_from_userdata(const void *userdata) {
  if (userdata == NULL) return NULL;

  uint64_t magic = 0;
  memcpy(&magic, userdata, sizeof(magic));
  if (magic != kMuxedGhosttySurfaceOwnerMagic) return NULL;
  return userdata;
}

static void muxed_ghostty_surface_owner_init(
    muxed_ghostty_surface_owner_s *owner, void *viewer) {
  if (owner == NULL) return;
  owner->magic = kMuxedGhosttySurfaceOwnerMagic;
  owner->surface = NULL;
  owner->viewer = viewer;
  owner->available = false;
}

static void muxed_ghostty_surface_owner_activate(
    muxed_ghostty_surface_owner_s *owner, ghostty_surface_t surface) {
  if (owner == NULL || surface == NULL) return;
  owner->surface = surface;
  owner->available = true;
}

static void muxed_ghostty_surface_owner_invalidate(
    muxed_ghostty_surface_owner_s *owner) {
  if (owner == NULL) return;
  owner->available = false;
  owner->surface = NULL;
  owner->viewer = NULL;
}

static ghostty_surface_t muxed_ghostty_owned_surface(
    const muxed_ghostty_surface_owner_s *owner) {
  owner = muxed_ghostty_surface_owner_from_userdata(owner);
  if (owner == NULL || !owner->available) return NULL;
  return owner->surface;
}

static void *muxed_ghostty_owned_viewer(
    const muxed_ghostty_surface_owner_s *owner) {
  owner = muxed_ghostty_surface_owner_from_userdata(owner);
  if (owner == NULL || !owner->available) return NULL;
  return owner->viewer;
}

typedef void (*muxed_ghostty_clipboard_completion_fn)(ghostty_surface_t,
                                                       const char *, void *,
                                                       bool);

static bool muxed_ghostty_complete_clipboard_text(
    const muxed_ghostty_surface_owner_s *owner, void *state, NSString *value,
    muxed_ghostty_clipboard_completion_fn complete) {
  ghostty_surface_t surface = muxed_ghostty_owned_surface(owner);
  if (surface == NULL || state == NULL || value == nil || complete == NULL)
    return false;

  const char *utf8 = value.UTF8String;
  if (utf8 == NULL) return false;

  complete(surface, utf8, state, false);
  return true;
}

static bool muxed_ghostty_confirm_clipboard_text(
    const muxed_ghostty_surface_owner_s *owner, void *state,
    const char *value, ghostty_clipboard_request_e request,
    muxed_ghostty_clipboard_completion_fn complete) {
  ghostty_surface_t surface = muxed_ghostty_owned_surface(owner);
  if (surface == NULL || state == NULL || value == NULL || complete == NULL ||
      request != GHOSTTY_CLIPBOARD_REQUEST_PASTE)
    return false;

  complete(surface, value, state, true);
  return true;
}

static bool runtime_read_clipboard(void *userdata, ghostty_clipboard_e clipboard,
                                   void *state) {
  const muxed_ghostty_surface_owner_s *owner =
      muxed_ghostty_surface_owner_from_userdata(userdata);
  if (muxed_ghostty_owned_surface(owner) == NULL || state == NULL ||
      clipboard != GHOSTTY_CLIPBOARD_STANDARD)
    return false;

  NSString *value =
      [[NSPasteboard generalPasteboard] stringForType:NSPasteboardTypeString];
  return muxed_ghostty_complete_clipboard_text(
      owner, state, value, ghostty_surface_complete_clipboard_request);
}

static void runtime_confirm_clipboard(
    void *userdata, const char *value, void *state,
    ghostty_clipboard_request_e request) {
  const muxed_ghostty_surface_owner_s *owner =
      muxed_ghostty_surface_owner_from_userdata(userdata);
  muxed_ghostty_confirm_clipboard_text(
      owner, state, value, request,
      ghostty_surface_complete_clipboard_request);
}
